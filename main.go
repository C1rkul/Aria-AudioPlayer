package main

import (
	"embed"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

type LocalFileHandler struct{}

func (l *LocalFileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/local/") {
		// Убираем префикс /local/
		path := strings.TrimPrefix(r.URL.Path, "/local/")

		// Декодируем URL (превращаем %20 в пробелы и т.д.)
		decodedPath, err := url.PathUnescape(path)
		if err != nil {
			fmt.Printf("❌ Ошибка декодирования пути: %v\n", err)
			http.NotFound(w, r)
			return
		}

		// В Windows заменяем прямые слеши на обратные
		decodedPath = strings.ReplaceAll(decodedPath, "/", "\\")

		fmt.Printf("🎵 Запрос файла: %s\n", decodedPath)

		// Отдаем файл
		http.ServeFile(w, r, decodedPath)
		return
	}

	// Если путь не наш, ничего не делаем
	fmt.Printf("📄 Запрос статики: %s\n", r.URL.Path)
}

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:         "Aria",
		Width:         1100,
		Height:        720,
		DisableResize: true,
		Frameless:     true,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: &LocalFileHandler{},
		},
		BackgroundColour: &options.RGBA{R: 17, G: 17, B: 17, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
