// iconctl — менеджер иконки приложения Aria Audio Player.
//
// Поток: drop («сбросить» иконку в очередь) → apply (применить, заменить).
// Плюс reset — вернуть стандартную Aria-иконку и status — что сейчас.
//
// Использование (из корня репозитория):
//
//	go run ./cmd/iconctl drop хэллоуин.png
//	go run ./cmd/iconctl apply                 # применить иконку из очереди
//	go run ./cmd/iconctl apply --radius 0.225 хэллоуин.png  # сразу, со скруглением
//	go run ./cmd/iconctl reset                 # обратно стандартная
//	go run ./cmd/iconctl status
//
// Что меняется при apply:
//
//	build/appicon.png              — иконка приложения (512×512, Wails)
//	build/windows/icon.ico         — иконка .exe (многослойная, из appicon)
//	frontend/public/favicon.png    — фавикон (ссылка автоматически вставляется
//	                                 в frontend/index.html, если её ещё нет)
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"flag"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "image/jpeg" // декодирование .jpg
)

const (
	appiconRel = "build/appicon.png"
	pendingRel = "build/pending-icon.png"
	metaRel    = "build/icon-meta.json"
	faviconRel = "frontend/public/favicon.png"
	indexRel   = "frontend/index.html"
	icoRel     = "build/windows/icon.ico"
	iconSize   = 512
)

var (
	defTileRGBA = [4]uint8{21, 21, 26, 255}   // фон стандартной плитки
	defAccent   = [4]uint8{124, 92, 255, 255} // акцент AriaMark
)

type meta struct {
	Source   string  `json:"source"`
	Kind     string  `json:"kind"` // "default" | "custom"
	Radius   float64 `json:"radius"`
	Fit      bool    `json:"fit"`
	Applied  string  `json:"applied"`
	Original string  `json:"original,omitempty"`
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "drop":
		err = cmdDrop(os.Args[2:])
	case "apply":
		err = cmdApply(os.Args[2:])
	case "reset":
		err = cmdReset(os.Args[2:])
	case "status":
		err = cmdStatus(os.Args[2:])
	case "-h", "--help", "help":
		usage()
		return
	default:
		fmt.Fprintf(os.Stderr, "неизвестная команда: %s\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ошибка:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Print(`iconctl — менеджер иконки приложения Aria Audio Player

Команды (запускать из корня репозитория):
  drop <файл.png|jpg>   «сбросить» свою иконку в очередь (build/pending-icon.png)
  apply [флаги] [файл]  применить иконку: заменяет build/appicon.png,
                        build/windows/icon.ico (.exe) и фавикон.
                        Файл можно указать прямо здесь — тогда drop не нужен.
  reset                 вернуть стандартную Aria-иконку
  status                показать текущее состояние

Флаги apply:
  --radius <доля>   скруглить углы, доля от стороны (0.225 — как у стандартной
                    плитки; по умолчанию 0 — как есть)
  --fit             вписать картинку целиком с прозрачными полями,
                    вместо обрезки по центру (по умолчанию — обрезка)

Примеры:
  go run ./cmd/iconctl drop halloween.png
  go run ./cmd/iconctl apply
  go run ./cmd/iconctl apply --radius 0.15 halloween.png
  go run ./cmd/iconctl reset

После apply пересоберите фронтенд (npm run build) и приложение (wails build):
новая иконка попадёт в .exe и фавикон.
`)
}

func repoRoot() error {
	if _, err := os.Stat("wails.json"); err != nil {
		return errors.New("запускайте из корня репозитория (нет wails.json)")
	}
	return nil
}

// ------------------------------- drop -------------------------------

func cmdDrop(args []string) error {
	if err := repoRoot(); err != nil {
		return err
	}
	if len(args) != 1 {
		return errors.New("нужен ровно один файл: drop <файл.png|jpg>")
	}
	img, format, err := decode(args[0])
	if err != nil {
		return fmt.Errorf("%s: %w", args[0], err)
	}
	b := img.Bounds()
	if err := os.MkdirAll("build", 0o755); err != nil {
		return err
	}
	if err := writePNG(pendingRel, img); err != nil {
		return err
	}
	m := meta{Source: filepath.Base(args[0]), Kind: "custom", Applied: time.Now().Format(time.RFC3339)}
	_ = writeMeta(m)
	fmt.Printf("иконка в очереди: %s\n", args[0])
	fmt.Printf("  формат: %s, размер: %d×%d\n", format, b.Dx(), b.Dy())
	fmt.Printf("  сохранена: %s\n", pendingRel)
	fmt.Println("применить:  go run ./cmd/iconctl apply")
	return nil
}

// ------------------------------- apply ------------------------------

func cmdApply(args []string) error {
	if err := repoRoot(); err != nil {
		return err
	}
	fs := flag.NewFlagSet("apply", flag.ContinueOnError)
	radius := fs.Float64("radius", 0, "скругление углов, доля от стороны")
	fit := fs.Bool("fit", false, "вписать целиком вместо обрезки")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var src image.Image
	var original string
	kind := "custom"

	if fs.NArg() == 1 {
		// путь указан сразу — это drop + apply одной командой
		img, _, err := decode(fs.Arg(0))
		if err != nil {
			return err
		}
		src, original = img, filepath.Base(fs.Arg(0))
	} else if fs.NArg() == 0 {
		// из очереди
		if _, err := os.Stat(pendingRel); err != nil {
			return errors.New("очередь пуста — сначала: drop <файл> (или укажите файл в apply)")
		}
		img, _, err := decode(pendingRel)
		if err != nil {
			return fmt.Errorf("очередь повреждена, повторите drop: %w", err)
		}
		src = img
		if m, err := readMeta(); err == nil && m.Source != "" {
			original = m.Source
		}
	} else {
		return errors.New("слишком много файлов — достаточно одного")
	}

	out := prepare(src, *fit, *radius)
	if err := os.MkdirAll(filepath.Dir(appiconRel), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(faviconRel), 0o755); err != nil {
		return err
	}
	if err := writePNG(appiconRel, out); err != nil {
		return err
	}
	if err := writePNG(faviconRel, out); err != nil {
		return err
	}
	if err := writeICOExe(out); err != nil {
		return err
	}
	if err := injectFaviconLink(); err != nil {
		return err
	}
	m := meta{Source: original, Kind: kind, Radius: *radius, Fit: *fit, Applied: time.Now().Format(time.RFC3339), Original: original}
	_ = writeMeta(m)

	fmt.Println("иконка применена:")
	fmt.Printf("  %s  (512×512, иконка приложения)\n", appiconRel)
	fmt.Printf("  %s  (иконка .exe)\n", icoRel)
	fmt.Printf("  %s  (фавикон)\n", faviconRel)
	if *radius > 0 {
		fmt.Printf("  скругление: %.3f\n", *radius)
	}
	fmt.Println("для .exe — пересоберите: wails build; фавикон обновится при npm run build")
	return nil
}

// prepare: обрезка/вписывание → 512×512 → опциональное скругление.
func prepare(src image.Image, fit bool, radius float64) image.Image {
	var base image.Image
	if fit {
		base = fitInside(src, iconSize)
	} else {
		base = cropCenter(src, iconSize)
	}
	out := scaleBox(base, iconSize, iconSize)
	if radius > 0 {
		out = roundCorners(out, radius)
	}
	return out
}

// ------------------------------- reset ------------------------------

func cmdReset(args []string) error {
	if err := repoRoot(); err != nil {
		return err
	}
	_ = os.Remove(pendingRel)
	img := defaultAriaIcon()
	if err := os.MkdirAll(filepath.Dir(appiconRel), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(faviconRel), 0o755); err != nil {
		return err
	}
	if err := writePNG(appiconRel, img); err != nil {
		return err
	}
	if err := writePNG(faviconRel, img); err != nil {
		return err
	}
	if err := writeICOExe(img); err != nil {
		return err
	}
	if err := injectFaviconLink(); err != nil {
		return err
	}
	_ = writeMeta(meta{Kind: "default", Applied: time.Now().Format(time.RFC3339)})
	fmt.Println("стандартная Aria-иконка восстановлена:")
	fmt.Printf("  %s\n  %s\n  %s\n", appiconRel, faviconRel, icoRel)
	return nil
}

// ------------------------------- status -----------------------------

func cmdStatus(args []string) error {
	if err := repoRoot(); err != nil {
		return err
	}
	fmt.Println("состояние иконки:")
	if fi, err := os.Stat(pendingRel); err == nil {
		fmt.Printf("  очередь:  есть (%s, %d Б)\n", fi.ModTime().Format("2006-01-02 15:04"), fi.Size())
	} else {
		fmt.Println("  очередь:  пуста")
	}
	if m, err := readMeta(); err == nil {
		kind := "стандартная Aria"
		if m.Kind == "custom" {
			kind = "своя"
			if m.Original != "" {
				kind += " (" + m.Original + ")"
			} else if m.Source != "" {
				kind += " (" + m.Source + ")"
			}
		}
		fmt.Printf("  применена: %s, %s\n", kind, m.Applied)
	} else {
		fmt.Println("  применена: нет данных (запустите reset или apply)")
	}
	for _, p := range []string{appiconRel, faviconRel, icoRel} {
		if fi, err := os.Stat(p); err == nil {
			fmt.Printf("  %s: %d Б\n", p, fi.Size())
		} else {
			fmt.Printf("  %s: отсутствует\n", p)
		}
	}
	return nil
}

// ============================ картинки ==============================

func decode(path string) (image.Image, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	img, format, err := image.Decode(f)
	if err != nil {
		return nil, "", fmt.Errorf("не удалось декодировать (нужен PNG или JPG): %w", err)
	}
	return img, format, nil
}

func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

// cropCenter: квадратный center-crop (cover) с последующим масштабированием.
func cropCenter(src image.Image, size int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	side := w
	if h < w {
		side = h
	}
	x0 := b.Min.X + (w-side)/2
	y0 := b.Min.Y + (h-side)/2
	dst := image.NewRGBA(image.Rect(0, 0, side, side))
	draw.Draw(dst, dst.Bounds(), src, image.Pt(x0, y0), draw.Src)
	if side == size {
		return dst
	}
	return scaleBox(dst, size, size)
}

// fitInside: вписать целиком в size×size на прозрачном фоне (contain).
func fitInside(src image.Image, size int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	sw, sh := float64(w), float64(h)
	scale := float64(size) / sw
	if s2 := float64(size) / sh; s2 < scale {
		scale = s2
	}
	nw, nh := int(math.Round(sw*scale)), int(math.Round(sh*scale))
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	scaled := scaleBox(src, nw, nh)
	dst := image.NewRGBA(image.Rect(0, 0, size, size)) // ноль = прозрачный
	draw.Draw(dst, image.Rect((size-nw)/2, (size-nh)/2, (size-nw)/2+nw, (size-nh)/2+nh), scaled, image.ZP, draw.Over)
	return dst
}

// scaleBox — area-реземплинг (усреднение по площади), без внешних зависимостей.
func scaleBox(src image.Image, dw, dh int) *image.RGBA {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw == dw && sh == dh {
		dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
		draw.Draw(dst, dst.Bounds(), src, b.Min, draw.Src)
		return dst
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	fx := float64(sw) / float64(dw)
	fy := float64(sh) / float64(dh)
	for y := 0; y < dh; y++ {
		y0 := float64(y) * fy
		y1 := float64(y+1) * fy
		sy0, sy1 := int(math.Floor(y0)), int(math.Ceil(y1))
		if sy0 < 0 {
			sy0 = 0
		}
		if sy1 > sh {
			sy1 = sh
		}
		for x := 0; x < dw; x++ {
			x0 := float64(x) * fx
			x1 := float64(x+1) * fx
			sx0, sx1 := int(math.Floor(x0)), int(math.Ceil(x1))
			if sx0 < 0 {
				sx0 = 0
			}
			if sx1 > sw {
				sx1 = sw
			}
			var sr, sg, sb, sa, wsum float64
			for sy := sy0; sy < sy1; sy++ {
				wy := math.Min(float64(sy+1), y1) - math.Max(float64(sy), y0)
				if wy <= 0 {
					continue
				}
				for sx := sx0; sx < sx1; sx++ {
					wx := math.Min(float64(sx+1), x1) - math.Max(float64(sx), x0)
					if wx <= 0 {
						continue
					}
					w := wx * wy
					r, g, bl, a := src.At(b.Min.X+sx, b.Min.Y+sy).RGBA()
					sr += float64(r) * w
					sg += float64(g) * w
					sb += float64(bl) * w
					sa += float64(a) * w
					wsum += w
				}
			}
			if wsum == 0 {
				continue
			}
			dst.SetRGBA(x, y, color.RGBA{
				R: uint8(sr / wsum / 256),
				G: uint8(sg / wsum / 256),
				B: uint8(sb / wsum / 256),
				A: uint8(sa / wsum / 256),
			})
		}
	}
	return dst
}

// roundCorners: скругленные углы, радиус = frac * сторона, AA ~1px.
func roundCorners(src *image.RGBA, frac float64) *image.RGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	r := frac * float64(w)
	if r > float64(w)/2 {
		r = float64(w) / 2
	}
	dst := image.NewRGBA(b)
	cx, cy := float64(w)/2, float64(h)/2
	hx, hy := float64(w)/2, float64(h)/2
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// signed distance до скругленного прямоугольника
			px := math.Abs(float64(x)+0.5-cx) - (hx - r)
			py := math.Abs(float64(y)+0.5-cy) - (hy - r)
			ox, oy := math.Max(px, 0), math.Max(py, 0)
			d := math.Hypot(ox, oy) + math.Min(math.Max(px, py), 0) - r
			f := 0.5 - d
			if f <= 0 {
				continue
			}
			if f > 1 {
				f = 1
			}
			i := dst.PixOffset(x, y)
			s := src.PixOffset(x, y)
			for c := 0; c < 4; c++ {
				dst.Pix[i+c] = uint8(float64(src.Pix[s+c]) * f)
			}
		}
	}
	return dst
}

// ===================== стандартная Aria-иконка ======================
// Порт make_appicon.py: тёмная плитка 0.225 + AriaMark (74%),
// суперсэмплинг ×4 → 512.

func defaultAriaIcon() image.Image {
	const ss = 4
	const S = iconSize * ss

	// --- тёмная плитка со скруглением ---
	tile := image.NewRGBA(image.Rect(0, 0, S, S))
	r := 0.225 * float64(S)
	cx, cy := float64(S)/2, float64(S)/2
	for y := 0; y < S; y++ {
		for x := 0; x < S; x++ {
			px := math.Abs(float64(x)+0.5-cx) - (float64(S)/2 - r)
			py := math.Abs(float64(y)+0.5-cy) - (float64(S)/2 - r)
			ox, oy := math.Max(px, 0), math.Max(py, 0)
			d := math.Hypot(ox, oy) + math.Min(math.Max(px, py), 0) - r
			f := 0.5 - d
			if f <= 0 {
				continue
			}
			if f > 1 {
				f = 1
			}
			i := tile.PixOffset(x, y)
			for c := 0; c < 3; c++ {
				tile.Pix[i+c] = uint8(float64(defTileRGBA[c]) * f)
			}
			tile.Pix[i+3] = uint8(float64(255) * f)
		}
	}

	// --- марка AriaMark: 5 отрезков, viewBox 32, k = S*0.74/32 ---
	mark := image.NewRGBA(image.Rect(0, 0, S, S))
	k := float64(S) * 0.74 / 32.0
	off := (float64(S) - 32*k) / 2
	P := func(x, y float64) (float64, float64) { return off + x*k, off + y*k }
	type seg struct{ x1, y1, x2, y2, w float64 }
	segs := []seg{
		{6, 27, 16, 5, 3.8},
		{16, 5, 26, 27, 3.8},
		{12.3, 22.8, 12.3, 17, 2.6},
		{16, 22.8, 16, 14, 2.6},
		{19.7, 22.8, 19.7, 16, 2.6},
	}
	for _, s := range segs {
		ax, ay := P(s.x1, s.y1)
		bx, by := P(s.x2, s.y2)
		drawSeg(mark, [2]float64{ax, ay}, [2]float64{bx, by}, s.w*k/2, defAccent)
	}

	// --- свечение: box-blur ×3 ≈ Gaussian σ≈S*0.02, alpha ×0.55 ---
	glow := cloneRGBA(mark)
	blurR := int(math.Round(float64(S) * 0.02)) // ~41 при S=2048
	if blurR < 1 {
		blurR = 1
	}
	for i := 0; i < 3; i++ {
		glow = boxBlur(glow, blurR)
	}
	for i := 0; i < len(glow.Pix); i += 4 {
		glow.Pix[i+3] = uint8(float64(glow.Pix[i+3]) * 0.55)
		glow.Pix[i] = uint8(float64(glow.Pix[i]) * 0.55)
		glow.Pix[i+1] = uint8(float64(glow.Pix[i+1]) * 0.55)
		glow.Pix[i+2] = uint8(float64(glow.Pix[i+2]) * 0.55)
	}

	// композитинг: glow → mark поверх плитки
	out := over(tile, glow)
	out = over(out, mark)
	return scaleBox(out, iconSize, iconSize)
}

// drawSeg — отрезок с круглыми концами (AA через расстояние).
func drawSeg(dst *image.RGBA, a, b [2]float64, rad float64, col [4]uint8) {
	minX := int(math.Floor(math.Min(a[0], b[0]) - rad - 1))
	maxX := int(math.Ceil(math.Max(a[0], b[0]) + rad + 1))
	minY := int(math.Floor(math.Min(a[1], b[1]) - rad - 1))
	maxY := int(math.Ceil(math.Max(a[1], b[1]) + rad + 1))
	if minX < 0 {
		minX = 0
	}
	if minY < 0 {
		minY = 0
	}
	if maxX > dst.Bounds().Dx() {
		maxX = dst.Bounds().Dx()
	}
	if maxY > dst.Bounds().Dy() {
		maxY = dst.Bounds().Dy()
	}
	dx, dy := b[0]-a[0], b[1]-a[1]
	ll := dx*dx + dy*dy
	for y := minY; y < maxY; y++ {
		for x := minX; x < maxX; x++ {
			px, py := float64(x)+0.5-a[0], float64(y)+0.5-a[1]
			t := 0.0
			if ll > 0 {
				t = (px*dx + py*dy) / ll
				if t < 0 {
					t = 0
				}
				if t > 1 {
					t = 1
				}
			}
			ex, ey := px-t*dx, py-t*dy
			d := math.Hypot(ex, ey)
			f := rad + 0.5 - d
			if f <= 0 {
				continue
			}
			if f > 1 {
				f = 1
			}
			overPix(dst, x, y, col, f)
		}
	}
}

// overPix — src(col×f) поверх dst (premultiplied, col a=255).
func overPix(dst *image.RGBA, x, y int, col [4]uint8, f float64) {
	i := dst.PixOffset(x, y)
	sa := f
	dst.Pix[i] = uint8(float64(col[0])*sa + float64(dst.Pix[i])*(1-sa))
	dst.Pix[i+1] = uint8(float64(col[1])*sa + float64(dst.Pix[i+1])*(1-sa))
	dst.Pix[i+2] = uint8(float64(col[2])*sa + float64(dst.Pix[i+2])*(1-sa))
	dst.Pix[i+3] = uint8(255*sa + float64(dst.Pix[i+3])*(1-sa))
}

// over — композитинг premultiplied.
func over(dst, src *image.RGBA) *image.RGBA {
	out := cloneRGBA(dst)
	b := out.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			si := src.PixOffset(x, y)
			di := out.PixOffset(x, y)
			sa := float64(src.Pix[si+3]) / 255
			if sa >= 1 {
				for c := 0; c < 4; c++ {
					out.Pix[di+c] = src.Pix[si+c]
				}
				continue
			}
			if sa <= 0 {
				continue
			}
			inv := 1 - sa
			for c := 0; c < 4; c++ {
				out.Pix[di+c] = uint8(float64(src.Pix[si+c]) + float64(out.Pix[di+c])*inv)
			}
		}
	}
	return out
}

func cloneRGBA(src *image.RGBA) *image.RGBA {
	dst := image.NewRGBA(src.Bounds())
	copy(dst.Pix, src.Pix)
	dst.Stride = src.Stride
	return dst
}

// boxBlur — разделяемый box-blur по 4 каналам (premultiplied), края = 0.
func boxBlur(src *image.RGBA, r int) *image.RGBA {
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	tmp := image.NewRGBA(image.Rect(0, 0, w, h))
	// горизонталь
	n := 2*r + 1
	for y := 0; y < h; y++ {
		var sr, sg, sb, sa int64
		row := y * src.Stride
		for x := -r; x <= r; x++ {
			if x >= 0 && x < w {
				i := row + x*4
				sr += int64(src.Pix[i])
				sg += int64(src.Pix[i+1])
				sb += int64(src.Pix[i+2])
				sa += int64(src.Pix[i+3])
			}
		}
		for x := 0; x < w; x++ {
			ri := y*tmp.Stride + x*4
			tmp.Pix[ri] = uint8(sr / int64(n))
			tmp.Pix[ri+1] = uint8(sg / int64(n))
			tmp.Pix[ri+2] = uint8(sb / int64(n))
			tmp.Pix[ri+3] = uint8(sa / int64(n))
			// выйти x-r, войти x+1+r
			if x-r >= 0 && x-r < w {
				i := row + (x - r) * 4
				sr -= int64(src.Pix[i])
				sg -= int64(src.Pix[i+1])
				sb -= int64(src.Pix[i+2])
				sa -= int64(src.Pix[i+3])
			}
			nx := x + 1 + r
			if nx >= 0 && nx < w {
				i := row + nx*4
				sr += int64(src.Pix[i])
				sg += int64(src.Pix[i+1])
				sb += int64(src.Pix[i+2])
				sa += int64(src.Pix[i+3])
			}
		}
	}
	// вертикаль
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		var sr, sg, sb, sa int64
		for y := -r; y <= r; y++ {
			if y >= 0 && y < h {
				i := y*tmp.Stride + x*4
				sr += int64(tmp.Pix[i])
				sg += int64(tmp.Pix[i+1])
				sb += int64(tmp.Pix[i+2])
				sa += int64(tmp.Pix[i+3])
			}
		}
		for y := 0; y < h; y++ {
			di := y*dst.Stride + x*4
			dst.Pix[di] = uint8(sr / int64(n))
			dst.Pix[di+1] = uint8(sg / int64(n))
			dst.Pix[di+2] = uint8(sb / int64(n))
			dst.Pix[di+3] = uint8(sa / int64(n))
			if y-r >= 0 && y-r < h {
				i := (y-r)*tmp.Stride + x*4
				sr -= int64(tmp.Pix[i])
				sg -= int64(tmp.Pix[i+1])
				sb -= int64(tmp.Pix[i+2])
				sa -= int64(tmp.Pix[i+3])
			}
			ny := y + 1 + r
			if ny >= 0 && ny < h {
				i := ny*tmp.Stride + x*4
				sr += int64(tmp.Pix[i])
				sg += int64(tmp.Pix[i+1])
				sb += int64(tmp.Pix[i+2])
				sa += int64(tmp.Pix[i+3])
			}
		}
	}
	return dst
}

// ============================ icon.ico ==============================

// writeICOExe — build/windows/icon.ico (Windows-иконка .exe) из текущего
// 512×512: многослойный ICO с PNG-контейнерами (поддерживается с Vista).
func writeICOExe(src512 image.Image) error {
	if err := os.MkdirAll(filepath.Dir(icoRel), 0o755); err != nil {
		return err
	}
	sizes := []int{16, 32, 48, 64, 128, 256}
	type layer struct {
		size int
		data []byte
	}
	var layers []layer
	for _, s := range sizes {
		var buf bytes.Buffer
		if err := png.Encode(&buf, scaleBox(src512, s, s)); err != nil {
			return err
		}
		layers = append(layers, layer{size: s, data: buf.Bytes()})
	}
	var out bytes.Buffer
	// ICONDIR
	_ = binary.Write(&out, binary.LittleEndian, uint16(0))
	_ = binary.Write(&out, binary.LittleEndian, uint16(1)) // тип: icon
	_ = binary.Write(&out, binary.LittleEndian, uint16(len(layers)))
	offset := 6 + 16*len(layers)
	for _, l := range layers {
		dim := l.size
		if dim >= 256 {
			dim = 0
		}
		out.WriteByte(uint8(dim)) // ширина
		out.WriteByte(uint8(dim)) // высота
		out.WriteByte(0)          // палитра
		out.WriteByte(0)          // зарезервировано
		_ = binary.Write(&out, binary.LittleEndian, uint16(1))  // planes
		_ = binary.Write(&out, binary.LittleEndian, uint16(32)) // bpp
		_ = binary.Write(&out, binary.LittleEndian, uint32(len(l.data)))
		_ = binary.Write(&out, binary.LittleEndian, uint32(offset))
		offset += len(l.data)
	}
	for _, l := range layers {
		out.Write(l.data)
	}
	return os.WriteFile(icoRel, out.Bytes(), 0o644)
}

// ============================ favicon ===============================

func injectFaviconLink() error {
	raw, err := os.ReadFile(indexRel)
	if err != nil {
		return err
	}
	if strings.Contains(string(raw), `rel="icon"`) {
		return nil
	}
	link := `    <link rel="icon" type="image/png" href="./favicon.png"/>` + "\n"
	updated := strings.Replace(string(raw), "</head>", link+"</head>", 1)
	if updated == string(raw) {
		return errors.New("не удалось вставить ссылку на фавикон в " + indexRel)
	}
	return os.WriteFile(indexRel, []byte(updated), 0o644)
}

// ============================ meta ==================================

func writeMeta(m meta) error {
	if err := os.MkdirAll("build", 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(metaRel, b, 0o644)
}

func readMeta() (meta, error) {
	var m meta
	b, err := os.ReadFile(metaRel)
	if err != nil {
		return m, err
	}
	err = json.Unmarshal(b, &m)
	return m, err
}
