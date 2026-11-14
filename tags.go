package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/bogem/id3v2/v2"
	"github.com/dhowden/tag"
	"github.com/gcottom/flacmeta"
	"github.com/gcottom/mp4meta"
	"github.com/gcottom/oggmeta"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ===================== Тегер: типы =====================

// TagFields — правки полей; nil = поле не трогать.
type TagFields struct {
	Title  *string `json:"title,omitempty"`
	Artist *string `json:"artist,omitempty"`
	Album  *string `json:"album,omitempty"`
	Year   *string `json:"year,omitempty"`
	Genre  *string `json:"genre,omitempty"`
	Track  *string `json:"track,omitempty"`
}

// TagEdit — одна запись: путь файла + какие поля менять.
type TagEdit struct {
	Path   string    `json:"path"`
	Fields TagFields `json:"fields"`
}

// TagWriteError — файл, в который не удалось записать.
type TagWriteError struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

// TagWriteResult — обновлённый список библиотеки + ошибки по файлам.
type TagWriteResult struct {
	Tracks []Track         `json:"tracks"`
	Errors []TagWriteError `json:"errors"`
}

// TagDetails — текущие теги файла (для предзаполнения инспектора).
type TagDetails struct {
	Path     string `json:"path"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Album    string `json:"album"`
	Year     string `json:"year"`
	Genre    string `json:"genre"`
	Track    string `json:"track"`
	Writable bool   `json:"writable"`
	Cover    string `json:"cover,omitempty"` // data-URL для предпросмотра
	HasCover bool   `json:"hasCover"`
}

// TagIssue — проблемы тегов одного трека (коды: no-title, empty-artist,
// unknown-artist, no-cover, junk-field, lower-title).
type TagIssue struct {
	TrackID string   `json:"trackId"`
	Path    string   `json:"path"`
	Issues  []string `json:"issues"`
}

// --- история правок (для отката) ---

type tagSnapshot struct {
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Album  string `json:"album"`
	Year   string `json:"year"`
	Genre  string `json:"genre"`
	Track  string `json:"track"`
}

type tagHistEdit struct {
	Path   string      `json:"path"`
	Before tagSnapshot `json:"before"`
	After  tagSnapshot `json:"after"`
}

// tagCoverHist — обложечная запись истории: прежняя обложка лежит в бэкап-файле,
// файл удаляется вместе с вытеснением пачки из истории или после успешного отката.
type tagCoverHist struct {
	Path       string `json:"path"`
	HadCover   bool   `json:"hadCover"`
	BackupFile string `json:"backupFile,omitempty"`
	MimeType   string `json:"mime,omitempty"`
}

type tagBatch struct {
	TS         int64          `json:"ts"`
	Edits      []tagHistEdit  `json:"edits,omitempty"`
	CoverEdits []tagCoverHist `json:"coverEdits,omitempty"`
}

type tagHistoryFile struct {
	Batches []tagBatch `json:"batches"`
}

// writableExt — форматы, в которые умеем записывать теги.
var writableExt = map[string]bool{
	".mp3":  true,
	".flac": true,
	".ogg":  true,
	".m4a":  true,
}

// ===================== Чтение =====================

func readTagSnapshot(path string) (tagSnapshot, error) {
	var s tagSnapshot
	f, err := os.Open(path)
	if err != nil {
		return s, err
	}
	defer f.Close()
	md, err := tag.ReadFrom(f)
	if err != nil {
		return s, err
	}
	s.Title = md.Title()
	s.Artist = md.Artist()
	s.Album = md.Album()
	if y := md.Year(); y > 0 {
		s.Year = strconv.Itoa(y)
	}
	s.Genre = md.Genre()
	if n, _ := md.Track(); n > 0 {
		s.Track = strconv.Itoa(n)
	}
	return s, nil
}

// GetTagDetails — текущие поля файла для инспектора.
func (a *App) GetTagDetails(path string) (TagDetails, error) {
	d := TagDetails{Path: path, Writable: writableExt[strings.ToLower(filepath.Ext(path))]}
	s, err := readTagSnapshot(path)
	if err == nil {
		d.Title, d.Artist, d.Album = s.Title, s.Artist, s.Album
		d.Year, d.Genre, d.Track = s.Year, s.Genre, s.Track
	}
	if mime, data, cerr := readCover(path); cerr == nil && len(data) > 0 {
		d.HasCover = true
		d.Cover = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	return d, nil
}

// ===================== Запись (атомарная) =====================

// writeViaCopy: копия файла → правка копии на месте → rename поверх оригинала.
// Оригинал не трогается, пока новая версия не готова (mp3: библиотека пишет внутрь файла).
func writeViaCopy(path string, mutate func(tmp string) error) error {
	tmp := path + ".ariatag.tmp"
	defer os.Remove(tmp)
	if err := copyFileContent(path, tmp); err != nil {
		return fmt.Errorf("копирование: %w", err)
	}
	if err := mutate(tmp); err != nil {
		return err
	}
	return replaceFile(tmp, path)
}

// writeViaSave: читаем оригинал → пишем полную новую версию в tmp → rename.
func writeViaSave(path string, save func(w io.Writer) error) error {
	tmp := path + ".ariatag.tmp"
	defer os.Remove(tmp)
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if err := save(out); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return replaceFile(tmp, path)
}

func copyFileContent(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func replaceFile(tmp, dst string) error {
	err := os.Rename(tmp, dst)
	if err == nil {
		return nil
	}
	// Windows иногда не даёт заменить существующий файл — пробуем через удаление
	if err2 := os.Remove(dst); err2 != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

// writeTagFields — диспетчер по форматам.
func writeTagFields(path, ext string, ed TagFields) error {
	switch ext {
	case ".mp3":
		return writeViaCopy(path, func(tmp string) error {
			t, err := id3v2.Open(tmp, id3v2.Options{Parse: true})
			if err != nil {
				return err
			}
			if ed.Title != nil {
				t.SetTitle(*ed.Title)
			}
			if ed.Artist != nil {
				t.SetArtist(*ed.Artist)
			}
			if ed.Album != nil {
				t.SetAlbum(*ed.Album)
			}
			if ed.Year != nil {
				t.SetYear(*ed.Year)
			}
			if ed.Genre != nil {
				t.SetGenre(*ed.Genre)
			}
			if ed.Track != nil {
				t.DeleteFrames("TRCK")
				if v := strings.TrimSpace(*ed.Track); v != "" {
					t.AddTextFrame("TRCK", id3v2.EncodingUTF8, v)
				}
			}
			if err := t.Save(); err != nil {
				t.Close()
				return err
			}
			return t.Close()
		})
	case ".flac":
		return writeViaSave(path, func(w io.Writer) error {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			ft, err := flacmeta.ReadFLAC(f)
			if err != nil {
				return err
			}
			if ed.Title != nil {
				ft.SetTitle(*ed.Title)
			}
			if ed.Artist != nil {
				ft.SetArtist(*ed.Artist)
			}
			if ed.Album != nil {
				ft.SetAlbum(*ed.Album)
			}
			if ed.Year != nil {
				ft.SetDate(*ed.Year)
			}
			if ed.Genre != nil {
				ft.SetGenre(*ed.Genre)
			}
			if ed.Track != nil {
				if n, err := strconv.Atoi(strings.Fields(strings.ReplaceAll(*ed.Track, "/", " "))[0]); err == nil {
					ft.SetTrackNumber(n)
				}
			}
			return ft.Save(w)
		})
	case ".ogg":
		return writeViaSave(path, func(w io.Writer) error {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			ot, err := oggmeta.ReadOGG(f)
			if err != nil {
				return err
			}
			if ed.Title != nil {
				ot.SetTitle(*ed.Title)
			}
			if ed.Artist != nil {
				ot.SetArtist(*ed.Artist)
			}
			if ed.Album != nil {
				ot.SetAlbum(*ed.Album)
			}
			if ed.Genre != nil {
				ot.SetGenre(*ed.Genre)
			}
			if ed.Track != nil {
				if n, err := strconv.Atoi(strings.Fields(strings.ReplaceAll(*ed.Track, "/", " "))[0]); err == nil {
					ot.SetTrackNumber(n)
				}
			}
			return ot.Save(w)
		})
	case ".m4a":
		return writeViaSave(path, func(w io.Writer) error {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			mt, err := mp4meta.ReadMP4(f)
			if err != nil {
				return err
			}
			if ed.Title != nil {
				mt.Title = *ed.Title
			}
			if ed.Artist != nil {
				mt.Artist = *ed.Artist
			}
			if ed.Album != nil {
				mt.Album = *ed.Album
			}
			if ed.Year != nil {
				mt.Year = *ed.Year
			}
			if ed.Genre != nil {
				mt.Genre = *ed.Genre
			}
			if ed.Track != nil {
				if n, err := strconv.Atoi(strings.Fields(strings.ReplaceAll(*ed.Track, "/", " "))[0]); err == nil {
					mt.TrackNumber = n
				}
			}
			return mt.Save(w)
		})
	default:
		return fmt.Errorf("запись тегов в формат %s не поддерживается", ext)
	}
}

// ===================== История (откат) =====================

func tagHistoryPath() (string, error) {
	dir, err := defaultAppDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "tags-history.json"), nil
}

func loadTagHistory() tagHistoryFile {
	var h tagHistoryFile
	p, err := tagHistoryPath()
	if err != nil {
		return h
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return h
	}
	_ = json.Unmarshal(data, &h)
	return h
}

func saveTagHistory(h tagHistoryFile) error {
	p, err := tagHistoryPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(h, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

// ===================== Публичные методы =====================

// WriteTags записывает теги в файлы и возвращает обновлённый список библиотеки.
// ID треков не меняются (путь тот же) — синхронизация не ломается.
func (a *App) WriteTags(edits []TagEdit, current []Track) (TagWriteResult, error) {
	res := TagWriteResult{Tracks: current, Errors: []TagWriteError{}}
	if len(edits) == 0 {
		return res, nil
	}
	idx := map[string]int{}
	for i, t := range res.Tracks {
		idx[filepath.Clean(t.Path)] = i
	}
	batch := tagBatch{TS: time.Now().UnixMilli()}
	for _, e := range edits {
		ext := strings.ToLower(filepath.Ext(e.Path))
		if !writableExt[ext] {
			res.Errors = append(res.Errors, TagWriteError{Path: e.Path, Error: fmt.Sprintf("формат %s — только чтение", ext)})
			continue
		}
		before, err := readTagSnapshot(e.Path)
		if err != nil {
			before = tagSnapshot{} // файл без тегов — начинаем с пустого снимка
		}
		after := before
		if e.Fields.Title != nil {
			after.Title = *e.Fields.Title
		}
		if e.Fields.Artist != nil {
			after.Artist = *e.Fields.Artist
		}
		if e.Fields.Album != nil {
			after.Album = *e.Fields.Album
		}
		if e.Fields.Year != nil {
			after.Year = *e.Fields.Year
		}
		if e.Fields.Genre != nil {
			after.Genre = *e.Fields.Genre
		}
		if e.Fields.Track != nil {
			after.Track = *e.Fields.Track
		}
		if after == before {
			continue // менять нечего
		}
		if err := writeTagFields(e.Path, ext, e.Fields); err != nil {
			res.Errors = append(res.Errors, TagWriteError{Path: e.Path, Error: err.Error()})
			continue
		}
		batch.Edits = append(batch.Edits, tagHistEdit{Path: e.Path, Before: before, After: after})
		if i, ok := idx[filepath.Clean(e.Path)]; ok {
			if after.Title != "" {
				res.Tracks[i].Title = after.Title // пустое название остаётся basename, как при скане
			}
			res.Tracks[i].Artist = after.Artist
			res.Tracks[i].Album = after.Album
		}
	}
	if len(batch.Edits) > 0 {
		a.appendTagBatch(batch)
	}
	return res, nil
}

// UndoLastTags откатывает последнюю пачку записанных тегов.
func (a *App) UndoLastTags(current []Track) (TagWriteResult, error) {
	res := TagWriteResult{Tracks: current, Errors: []TagWriteError{}}
	h := loadTagHistory()
	if len(h.Batches) == 0 {
		return res, fmt.Errorf("история правок пуста")
	}
	last := h.Batches[len(h.Batches)-1]
	h.Batches = h.Batches[:len(h.Batches)-1]
	idx := map[string]int{}
	for i, t := range res.Tracks {
		idx[filepath.Clean(t.Path)] = i
	}
	for _, e := range last.Edits {
		ext := strings.ToLower(filepath.Ext(e.Path))
		if !writableExt[ext] {
			res.Errors = append(res.Errors, TagWriteError{Path: e.Path, Error: fmt.Sprintf("формат %s — только чтение", ext)})
			continue
		}
		ed := TagFields{
			Title:  &e.Before.Title,
			Artist: &e.Before.Artist,
			Album:  &e.Before.Album,
			Year:   &e.Before.Year,
			Genre:  &e.Before.Genre,
			Track:  &e.Before.Track,
		}
		if err := writeTagFields(e.Path, ext, ed); err != nil {
			res.Errors = append(res.Errors, TagWriteError{Path: e.Path, Error: err.Error()})
			continue
		}
		if i, ok := idx[filepath.Clean(e.Path)]; ok {
			if e.Before.Title != "" {
				res.Tracks[i].Title = e.Before.Title
			}
			res.Tracks[i].Artist = e.Before.Artist
			res.Tracks[i].Album = e.Before.Album
		}
	}
	// обложки: восстановить из бэкапа или убрать — вместе с остальными полями пачки
	for _, c := range last.CoverEdits {
		ext := strings.ToLower(filepath.Ext(c.Path))
		if !writableExt[ext] {
			res.Errors = append(res.Errors, TagWriteError{Path: c.Path, Error: fmt.Sprintf("формат %s — только чтение", ext)})
			continue
		}
		var restore []byte
		if c.HadCover {
			b, rerr := os.ReadFile(c.BackupFile)
			if rerr != nil {
				res.Errors = append(res.Errors, TagWriteError{Path: c.Path, Error: "бэкап обложки недоступен: " + rerr.Error()})
				continue
			}
			restore = b
		}
		if err := writeCover(c.Path, ext, restore); err != nil {
			res.Errors = append(res.Errors, TagWriteError{Path: c.Path, Error: err.Error()})
			continue
		}
		if i, ok := idx[filepath.Clean(c.Path)]; ok {
			old := res.Tracks[i].CoverPath
			if len(restore) == 0 {
				if old != "" {
					os.Remove(old)
					res.Tracks[i].CoverPath = ""
				}
			} else if _, _, _, cp := a.extractMetadataSafe(c.Path, res.Tracks[i].ID); cp != "" {
				if old != "" && old != cp {
					os.Remove(old)
				}
				res.Tracks[i].CoverPath = cp
			}
		}
		if c.BackupFile != "" {
			os.Remove(c.BackupFile)
		}
	}
	if len(last.CoverEdits) > 0 {
		_ = a.SaveTracks(res.Tracks)
	}
	_ = saveTagHistory(h)
	return res, nil
}

// TagDiagnostics — треки с проблемами тегов (для вкладки «Проблемы»).
func (a *App) TagDiagnostics(current []Track) []TagIssue {
	out := []TagIssue{}
	for _, t := range current {
		var issues []string
		if t.Path != "" && t.Title == filepath.Base(t.Path) {
			issues = append(issues, "no-title")
		}
		artist := strings.TrimSpace(t.Artist)
		if artist == "" {
			issues = append(issues, "empty-artist")
		} else if isUnknownArtist(artist) {
			issues = append(issues, "unknown-artist")
		}
		if t.CoverPath == "" {
			issues = append(issues, "no-cover")
		}
		if hasJunk(t.Title) || hasJunk(t.Artist) || hasJunk(t.Album) {
			issues = append(issues, "junk-field")
		}
		if startsLower(t.Title) {
			issues = append(issues, "lower-title")
		}
		if len(issues) > 0 {
			out = append(out, TagIssue{TrackID: t.ID, Path: t.Path, Issues: issues})
		}
	}
	return out
}

// ===================== Хелперы диагностики =====================

func hasJunk(s string) bool {
	if s != strings.TrimSpace(s) {
		return true
	}
	if strings.ContainsAny(s, "\u00a0\u200b\ufeff\t") {
		return true
	}
	return strings.Contains(s, "  ")
}

func startsLower(s string) bool {
	for _, r := range s {
		if unicode.IsSpace(r) {
			continue
		}
		return unicode.IsLower(r)
	}
	return false
}

func isUnknownArtist(a string) bool {
	l := strings.ToLower(strings.TrimSpace(a))
	switch l {
	case "unknown", "unknown artist", "various artists", "n/a", "разные исполнители", "несколько исполнителей":
		return true
	}
	return strings.Contains(l, "unknown")
}

// ===================== Обложки =====================

// readCover — встроенная обложка файла (пусто, если обложки нет).
func readCover(path string) (mimeType string, data []byte, err error) {
	f, err := os.Open(path)
	if err != nil {
		return "", nil, err
	}
	defer f.Close()
	md, err := tag.ReadFrom(f)
	if err != nil {
		return "", nil, err
	}
	pic := md.Picture()
	if pic == nil || len(pic.Data) == 0 {
		return "", nil, nil
	}
	return pic.MIMEType, pic.Data, nil
}

// decodeCoverImage — байты изображения -> image (nil, nil если данных нет).
func decodeCoverImage(data []byte) (*image.Image, error) {
	if len(data) == 0 {
		return nil, nil
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("не удалось прочитать изображение: %w", err)
	}
	return &img, nil
}

// writeCover — атомарная запись встроенной обложки; пустые data = удаление.
// mp3 — оригинальные байты (APIC), flac/ogg/m4a — пере-кодирование библиотеками.
func writeCover(path, ext string, data []byte) error {
	remove := len(data) == 0
	switch ext {
	case ".mp3":
		return writeViaCopy(path, func(tmp string) error {
			t, err := id3v2.Open(tmp, id3v2.Options{Parse: true})
			if err != nil {
				return err
			}
			t.DeleteFrames("APIC")
			if !remove {
				t.AddAttachedPicture(id3v2.PictureFrame{
					Encoding:    id3v2.EncodingUTF8,
					MimeType:    http.DetectContentType(data),
					PictureType: 3, // front cover
					Description: "Cover (front)",
					Picture:     data,
				})
			}
			if err := t.Save(); err != nil {
				t.Close()
				return err
			}
			return t.Close()
		})
	case ".flac":
		return writeViaSave(path, func(w io.Writer) error {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			ft, err := flacmeta.ReadFLAC(f)
			if err != nil {
				return err
			}
			img, err := decodeCoverImage(data)
			if err != nil {
				return err
			}
			ft.SetCoverArt(img)
			return ft.Save(w)
		})
	case ".ogg":
		return writeViaSave(path, func(w io.Writer) error {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			ot, err := oggmeta.ReadOGG(f)
			if err != nil {
				return err
			}
			img, err := decodeCoverImage(data)
			if err != nil {
				return err
			}
			ot.SetCoverArt(img)
			return ot.Save(w)
		})
	case ".m4a":
		return writeViaSave(path, func(w io.Writer) error {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			mt, err := mp4meta.ReadMP4(f)
			if err != nil {
				return err
			}
			img, err := decodeCoverImage(data)
			if err != nil {
				return err
			}
			mt.SetCoverArt(img)
			return mt.Save(w)
		})
	default:
		return fmt.Errorf("обложки в формат %s не поддерживаются", ext)
	}
}

// tagBackupsDir — папка бэкапов обложек (рядом с кэшем обложек).
func (a *App) tagBackupsDir() (string, error) {
	dir := a.settings.DataFolder
	if dir == "" {
		fallback, err := defaultAppDir()
		if err != nil {
			return "", err
		}
		dir = fallback
	}
	p := filepath.Join(dir, "tagbackups")
	if err := os.MkdirAll(p, 0755); err != nil {
		return "", err
	}
	return p, nil
}

// appendTagBatch — пачка в историю (cap 100); бэкапы вытесненных пачек чистим.
func (a *App) appendTagBatch(batch tagBatch) {
	h := loadTagHistory()
	h.Batches = append(h.Batches, batch)
	if len(h.Batches) > 100 {
		for _, old := range h.Batches[:len(h.Batches)-100] {
			for _, c := range old.CoverEdits {
				if c.BackupFile != "" {
					os.Remove(c.BackupFile)
				}
			}
		}
		h.Batches = h.Batches[len(h.Batches)-100:]
	}
	_ = saveTagHistory(h)
}

// SetTrackCover ставит (remove=false) или удаляет (remove=true) обложку файла.
// Прежняя обложка уходит в бэкап — «Откатить последнее» её вернёт.
// Возвращает обновлённый список: кэш обложки трека пересобран, диск согласован.
func (a *App) SetTrackCover(path string, remove bool, imagePath string, current []Track) (TagWriteResult, error) {
	res := TagWriteResult{Tracks: current, Errors: []TagWriteError{}}
	ext := strings.ToLower(filepath.Ext(path))
	if !writableExt[ext] {
		return res, fmt.Errorf("формат %s — только чтение", ext)
	}
	var newData []byte
	if !remove {
		if strings.TrimSpace(imagePath) == "" {
			return res, fmt.Errorf("не выбрано изображение")
		}
		b, err := os.ReadFile(imagePath)
		if err != nil {
			return res, fmt.Errorf("чтение изображения: %w", err)
		}
		if _, err := decodeCoverImage(b); err != nil {
			return res, err
		}
		newData = b
	}

	oldMime, oldData, _ := readCover(path)
	if remove && len(oldData) == 0 {
		return res, nil // удалять нечего — в историю не пишем
	}
	hist := tagCoverHist{Path: path, HadCover: len(oldData) > 0, MimeType: oldMime}
	if hist.HadCover {
		dir, err := a.tagBackupsDir()
		if err != nil {
			return res, err
		}
		bp := filepath.Join(dir, fmt.Sprintf("%d_%d%s", time.Now().UnixNano(), len(oldData), backupExtFor(oldMime)))
		if err := os.WriteFile(bp, oldData, 0644); err != nil {
			return res, fmt.Errorf("бэкап обложки: %w", err)
		}
		hist.BackupFile = bp
	}

	if err := writeCover(path, ext, newData); err != nil {
		if hist.BackupFile != "" {
			os.Remove(hist.BackupFile)
		}
		return res, err
	}

	// кэш обложки трека: старый файл убрать, новый пересобрать из файла
	idx := -1
	for i, tr := range res.Tracks {
		if filepath.Clean(tr.Path) == filepath.Clean(path) {
			idx = i
			break
		}
	}
	if idx >= 0 {
		oldCache := res.Tracks[idx].CoverPath
		if len(newData) == 0 {
			if oldCache != "" {
				os.Remove(oldCache)
				res.Tracks[idx].CoverPath = ""
			}
		} else if _, _, _, cp := a.extractMetadataSafe(path, res.Tracks[idx].ID); cp != "" {
			if oldCache != "" && oldCache != cp {
				os.Remove(oldCache)
			}
			res.Tracks[idx].CoverPath = cp
		}
	}
	_ = a.SaveTracks(res.Tracks)
	a.appendTagBatch(tagBatch{TS: time.Now().UnixMilli(), CoverEdits: []tagCoverHist{hist}})
	return res, nil
}

func backupExtFor(mime string) string {
	switch strings.ToLower(mime) {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	}
	return ".jpg"
}

// PickCoverImage — системный диалог выбора картинки обложки (jpg/png/gif).
func (a *App) PickCoverImage() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Выберите изображение обложки",
		Filters: []runtime.FileFilter{
			{DisplayName: "Изображения (jpg, png, gif)", Pattern: "*.jpg;*.jpeg;*.png;*.gif"},
		},
	})
}
