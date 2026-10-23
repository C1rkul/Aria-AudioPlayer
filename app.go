package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goRuntime "runtime"
	"strings"
	"sync"
	"time"

	"github.com/dhowden/tag"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Track struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Artist    string  `json:"artist,omitempty"`
	Album     string  `json:"album,omitempty"`
	Path      string  `json:"path"`
	Source    string  `json:"source"`
	CoverPath string  `json:"coverPath,omitempty"`
	Duration  float64 `json:"duration"`
}

// Playlist — пользовательский плейлист; хранит только id треков библиотеки.
type Playlist struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	TrackIDs  []string `json:"trackIds"`
	CreatedAt int64    `json:"createdAt"`
}

// QueueState — очередь воспроизведения (сохраняется между запусками).
// SourceID: "all" (вся библиотека) или id плейлиста, из которого собрана очередь.
type QueueState struct {
	SourceID string   `json:"sourceId"`
	TrackIDs []string `json:"trackIds"`
	Index    int      `json:"index"`
}

type PlaylistsData struct {
	Playlists []Playlist `json:"playlists"`
	Queue     QueueState `json:"queue"`
}

type Settings struct {
	Theme              string  `json:"theme"`
	Design             string  `json:"design"`
	Background         string  `json:"background"`
	Palette            string  `json:"palette"`
	AdaptiveBackground bool    `json:"adaptiveBackground"`
	NeonFrame          bool    `json:"neonFrame"`
	ParticleCount      int     `json:"particleCount"`
	BabbleCount        int     `json:"babbleCount"`
	MatrixSpeed        float64 `json:"matrixSpeed"`
	MatrixDensity      int     `json:"matrixDensity"`
	AuroraCount        int     `json:"auroraCount"`
	VizPreset          string  `json:"vizPreset"`
	VizBars            int     `json:"vizBars"`
	VizSpin            bool    `json:"vizSpin"`
	LastSeenVersion    string  `json:"lastSeenVersion"`
	LyricsAPIURL       string  `json:"lyricsApiUrl"`
	CustomAccent       string  `json:"customAccent"`
	DefaultVolume      float64 `json:"defaultVolume"`
	RestoreLastTrack   bool    `json:"restoreLastTrack"`
	DataFolder         string  `json:"dataFolder"`
	LastTrackID        string  `json:"lastTrackId"`
	LastPosition       float64 `json:"lastPosition"`
}

type App struct {
	ctx      context.Context
	settings Settings

	streamMu       sync.RWMutex
	streamBaseURL  string
	streamListener net.Listener
}

var allowedAudioExtensions = map[string]bool{
	".mp3":  true,
	".wav":  true,
	".ogg":  true,
	".flac": true,
	".m4a":  true,
	".aac":  true,
}

func NewApp() *App {
	return &App{
		settings: defaultSettings(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	_ = a.loadSettingsInternal()
	a.ensureStreamServer()
}

func generateID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func defaultAppDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	appDir := filepath.Join(homeDir, "Documents", "audioplayer")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return "", err
	}
	return appDir, nil
}

func defaultSettings() Settings {
	dir, _ := defaultAppDir()
	return Settings{
		Theme:            "dark",
		Design:           "normal",
		Background:       "none",
		Palette:          "base",
		NeonFrame:        true,
		ParticleCount:    60,
		BabbleCount:      22,
		MatrixSpeed:      1.0,
		MatrixDensity:    100,
		AuroraCount:      5,
		VizPreset:        "base",
		VizBars:          48,
		CustomAccent:     "#7c5cff",
		DefaultVolume:    0.5,
		RestoreLastTrack: false,
		DataFolder:       dir,
		LastTrackID:      "",
		LastPosition:     0,
	}
}

// clampInt: 0 (поле отсутствует) -> значение по умолчанию, иначе ограничение диапазоном
func clampInt(v, lo, hi, def int) int {
	if v == 0 {
		return def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func normalizeSettings(s *Settings) {
	validTheme := map[string]bool{"dark": true, "light": true}
	if !validTheme[s.Theme] {
		s.Theme = "dark"
	}

	validDesign := map[string]bool{"normal": true, "glass": true, "glass_plus": true}
	if !validDesign[s.Design] {
		s.Design = "normal"
	}

	validBackground := map[string]bool{"none": true, "particle": true, "babble": true, "matrix": true, "aurora": true}
	if !validBackground[s.Background] {
		s.Background = "none"
	}

	if s.Palette != "custom" {
		s.Palette = "base"
	}
	if strings.TrimSpace(s.CustomAccent) == "" {
		s.CustomAccent = "#7c5cff"
	}
	if s.DefaultVolume < 0 || s.DefaultVolume > 1 {
		s.DefaultVolume = 0.5
	}

	s.ParticleCount = clampInt(s.ParticleCount, 10, 200, 60)
	s.BabbleCount = clampInt(s.BabbleCount, 5, 60, 22)
	s.MatrixDensity = clampInt(s.MatrixDensity, 10, 100, 100)
	s.AuroraCount = clampInt(s.AuroraCount, 1, 12, 5)
	s.VizBars = clampInt(s.VizBars, 8, 128, 48)
	validViz := map[string]bool{"base": true, "circle": true, "big": true}
	if !validViz[s.VizPreset] {
		s.VizPreset = "base"
	}
	if s.MatrixSpeed < 0.3 || s.MatrixSpeed > 3 {
		s.MatrixSpeed = 1.0
	}

	if s.DataFolder == "" {
		dir, _ := defaultAppDir()
		s.DataFolder = dir
	} else {
		_ = os.MkdirAll(s.DataFolder, 0755)
	}
}

func (a *App) settingsFilePath() (string, error) {
	dir, err := defaultAppDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

func (a *App) tracksFilePath() (string, error) {
	dir := a.settings.DataFolder
	if dir == "" {
		fallback, err := defaultAppDir()
		if err != nil {
			return "", err
		}
		dir = fallback
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "tracks.json"), nil
}

func (a *App) coversDir() (string, error) {
	dir := a.settings.DataFolder
	if dir == "" {
		fallback, err := defaultAppDir()
		if err != nil {
			return "", err
		}
		dir = fallback
	}
	covers := filepath.Join(dir, "covers")
	if err := os.MkdirAll(covers, 0755); err != nil {
		return "", err
	}
	return covers, nil
}

func (a *App) loadSettingsInternal() error {
	path, err := a.settingsFilePath()
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		a.settings = defaultSettings()
		return a.saveSettingsInternal(a.settings)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	// Поля, которых нет в старом settings.json, остаются со значениями по умолчанию
	s := defaultSettings()
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	a.settings = s
	normalizeSettings(&a.settings)
	return nil
}

func (a *App) saveSettingsInternal(s Settings) error {
	path, err := a.settingsFilePath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func (a *App) LoadSettings() (Settings, error) {
	if err := a.loadSettingsInternal(); err != nil {
		a.settings = defaultSettings()
	}
	normalizeSettings(&a.settings)
	return a.settings, nil
}

func (a *App) SaveSettings(s Settings) (Settings, error) {
	normalizeSettings(&s)
	a.settings = s
	if err := a.saveSettingsInternal(s); err != nil {
		return s, err
	}
	return s, nil
}

func (a *App) LoadTracks() ([]Track, error) {
	path, err := a.tracksFilePath()
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return []Track{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var tracks []Track
	if err := json.Unmarshal(data, &tracks); err != nil {
		return nil, err
	}
	if tracks == nil {
		tracks = []Track{}
	}
	fmt.Printf("✅ Загружено треков: %d\n", len(tracks))
	return tracks, nil
}

func (a *App) SaveTracks(tracks []Track) error {
	path, err := a.tracksFilePath()
	if err != nil {
		return err
	}
	if tracks == nil {
		tracks = []Track{}
	}
	data, err := json.MarshalIndent(tracks, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return err
	}
	fmt.Printf("💾 Сохранено треков: %d в файл %s\n", len(tracks), path)
	return nil
}

func (a *App) playlistsFilePath() (string, error) {
	tp, err := a.tracksFilePath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(tp), "playlists.json"), nil
}

func emptyPlaylistsData() PlaylistsData {
	return PlaylistsData{
		Playlists: []Playlist{},
		Queue:     QueueState{SourceID: "all", TrackIDs: []string{}, Index: -1},
	}
}

// LoadPlaylistsData читает playlists.json (плейлисты + очередь). Нет файла — пустые данные.
func (a *App) LoadPlaylistsData() (PlaylistsData, error) {
	path, err := a.playlistsFilePath()
	if err != nil {
		return emptyPlaylistsData(), err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return emptyPlaylistsData(), nil
		}
		return emptyPlaylistsData(), err
	}
	pd := emptyPlaylistsData()
	if err := json.Unmarshal(data, &pd); err != nil {
		return emptyPlaylistsData(), err
	}
	if pd.Playlists == nil {
		pd.Playlists = []Playlist{}
	}
	for i := range pd.Playlists {
		if pd.Playlists[i].TrackIDs == nil {
			pd.Playlists[i].TrackIDs = []string{}
		}
	}
	if pd.Queue.TrackIDs == nil {
		pd.Queue.TrackIDs = []string{}
	}
	if pd.Queue.SourceID == "" {
		pd.Queue.SourceID = "all"
	}
	return pd, nil
}

// SavePlaylistsData сохраняет плейлисты и очередь (запись через временный файл).
func (a *App) SavePlaylistsData(pd PlaylistsData) error {
	path, err := a.playlistsFilePath()
	if err != nil {
		return err
	}
	if pd.Playlists == nil {
		pd.Playlists = []Playlist{}
	}
	if pd.Queue.TrackIDs == nil {
		pd.Queue.TrackIDs = []string{}
	}
	data, err := json.MarshalIndent(pd, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// --- NEW FEATURE: Add Folder ---

func (a *App) OpenLocalFolderDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Выберите папку с музыкой",
	})
}

func (a *App) AddLocalFolder(folderPath string) ([]Track, error) {
	if folderPath == "" {
		return nil, fmt.Errorf("путь к папке пуст")
	}

	info, err := os.Stat(folderPath)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("указанный путь не является папкой или не существует")
	}

	fmt.Printf("🔍 Сканирование папки: %s\n", folderPath)
	tracks := a.scanDirectoryForTracks(folderPath)

	fmt.Printf("🏷️ Найдено треков в папке: %d\n", len(tracks))
	return tracks, nil
}

func (a *App) scanDirectoryForTracks(root string) []Track {
	var foundTracks []Track

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !allowedAudioExtensions[ext] {
			return nil
		}

		id := generateID()
		title, artist, album, coverPath := a.extractMetadataSafe(path, id)

		if strings.TrimSpace(title) == "" {
			title = filepath.Base(path)
		}

		track := Track{
			ID:        id,
			Title:     title,
			Artist:    artist,
			Album:     album,
			Path:      path,
			Source:    "local",
			CoverPath: coverPath,
			Duration:  0,
		}

		foundTracks = append(foundTracks, track)
		return nil
	})

	if err != nil {
		fmt.Printf("❌ Ошибка при сканировании папки: %v\n", err)
	}

	return foundTracks
}

// Безопасное извлечение метаданных (не падает, если тегов нет)
func (a *App) extractMetadataSafe(path, trackID string) (title, artist, album, coverPath string) {
	f, err := os.Open(path)
	if err != nil {
		fmt.Printf("❌ Не удалось открыть файл для метаданных %s: %v\n", path, err)
		return filepath.Base(path), "", "", "" // Возвращаем имя файла как заголовок
	}
	defer f.Close()

	t, err := tag.ReadFrom(f)
	if err != nil {
		// Теги отсутствуют или повреждены — это нормально для многих файлов
		// fmt.Printf("ℹ️ Нет тегов в %s\n", filepath.Base(path))
		return filepath.Base(path), "", "", ""
	}

	title = strings.TrimSpace(t.Title())
	artist = strings.TrimSpace(t.Artist())
	album = strings.TrimSpace(t.Album())

	// Попытка получить обложку
	pic := t.Picture()
	if pic != nil && len(pic.Data) > 0 {
		ext := ".jpg"
		switch strings.ToLower(pic.MIMEType) {
		case "image/png":
			ext = ".png"
		case "image/gif":
			ext = ".gif"
		case "image/webp":
			ext = ".webp"
		}

		cp, saveErr := a.saveCoverBytes(trackID, pic.Data, ext)
		if saveErr == nil {
			coverPath = cp
		}
	}

	return title, artist, album, coverPath
}

func (a *App) saveCoverBytes(trackID string, data []byte, ext string) (string, error) {
	dir, err := a.coversDir()
	if err != nil {
		return "", err
	}
	coverPath := filepath.Join(dir, trackID+ext)
	if err := os.WriteFile(coverPath, data, 0644); err != nil {
		return "", err
	}
	return coverPath, nil
}

func (a *App) OpenLocalFiles() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Выберите аудиофайлы",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Аудиофайлы (*.mp3, *.wav, *.ogg, *.flac)",
				Pattern:     "*.mp3;*.wav;*.ogg;*.flac",
			},
		},
	})
}

func (a *App) AddLocalFiles() ([]Track, error) {
	paths, err := a.OpenLocalFiles()
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return []Track{}, nil
	}

	tracks := make([]Track, 0, len(paths))
	for _, path := range paths {
		id := generateID()
		title, artist, album, coverPath := a.extractMetadataSafe(path, id)
		if strings.TrimSpace(title) == "" {
			title = filepath.Base(path)
		}

		tracks = append(tracks, Track{
			ID:        id,
			Title:     title,
			Artist:    artist,
			Album:     album,
			Path:      path,
			Source:    "local",
			CoverPath: coverPath,
			Duration:  0,
		})
	}
	fmt.Printf("🏷️ Добавлено треков с метаданными: %d\n", len(tracks))
	return tracks, nil
}

// AddPaths принимает пути, перетащенные в окно: папки сканируются рекурсивно,
// отдельные файлы добавляются, если у них поддерживаемое расширение.
func (a *App) AddPaths(paths []string) ([]Track, error) {
	tracks := []Track{}
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		if info.IsDir() {
			tracks = append(tracks, a.scanDirectoryForTracks(p)...)
			continue
		}
		if !allowedAudioExtensions[strings.ToLower(filepath.Ext(p))] {
			continue
		}
		id := generateID()
		title, artist, album, coverPath := a.extractMetadataSafe(p, id)
		if strings.TrimSpace(title) == "" {
			title = filepath.Base(p)
		}
		tracks = append(tracks, Track{ID: id, Title: title, Artist: artist, Album: album,
			Path: p, Source: "local", CoverPath: coverPath})
	}
	return tracks, nil
}

func (a *App) ReadFileAsDataURL(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Printf("❌ Ошибка чтения файла %s: %v\n", path, err)
		return "", err
	}

	ext := strings.ToLower(filepath.Ext(path))
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		switch ext {
		case ".mp3":
			mimeType = "audio/mpeg"
		case ".wav":
			mimeType = "audio/wav"
		case ".ogg":
			mimeType = "audio/ogg"
		case ".flac":
			mimeType = "audio/flac"
		case ".m4a":
			mimeType = "audio/mp4"
		case ".aac":
			mimeType = "audio/aac"
		default:
			mimeType = "application/octet-stream"
		}
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, encoded)
	fmt.Printf("✅ Файл прочитан как data URL: %s (%d байт)\n", path, len(data))
	return dataURL, nil
}

func (a *App) OpenDataFolder() error {
	dir := a.settings.DataFolder
	if dir == "" {
		fallback, err := defaultAppDir()
		if err != nil {
			return err
		}
		dir = fallback
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	var cmd *exec.Cmd
	switch goRuntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}

func (a *App) ensureStreamServer() string {
	a.streamMu.Lock()
	defer a.streamMu.Unlock()
	if a.streamBaseURL != "" {
		return a.streamBaseURL
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Printf("❌ Не удалось запустить стрим-сервер: %v\n", err)
		return ""
	}

	a.streamListener = ln
	a.streamBaseURL = fmt.Sprintf("http://%s", ln.Addr().String())

	mux := http.NewServeMux()
	mux.HandleFunc("/stream", a.handleStream)
	mux.HandleFunc("/cover", a.handleCover)

	server := &http.Server{Handler: a.corsMiddleware(mux)}
	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			fmt.Printf("❌ Ошибка стрим-сервера: %v\n", err)
		}
	}()

	fmt.Printf("🌐 Стрим-сервер запущен: %s\n", a.streamBaseURL)
	return a.streamBaseURL
}

func (a *App) GetStreamBaseURL() (string, error) {
	base := a.ensureStreamServer()
	if base == "" {
		return "", fmt.Errorf("стрим-сервер не запущен")
	}
	return base, nil
}

func (a *App) validateStreamPath(rawPath string) (string, error) {
	if strings.TrimSpace(rawPath) == "" {
		return "", fmt.Errorf("пустой путь к файлу")
	}
	absPath, err := filepath.Abs(rawPath)
	if err != nil {
		return "", err
	}
	absPath = filepath.Clean(absPath)
	info, err := os.Stat(absPath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("путь указывает на папку, а не на файл")
	}
	ext := strings.ToLower(filepath.Ext(absPath))
	if !allowedAudioExtensions[ext] {
		return "", fmt.Errorf("неподдерживаемый формат аудио: %s", ext)
	}
	return absPath, nil
}

func (a *App) validateCoverPath(rawPath string) (string, error) {
	if strings.TrimSpace(rawPath) == "" {
		return "", fmt.Errorf("пустой путь к обложке")
	}
	absPath, err := filepath.Abs(rawPath)
	if err != nil {
		return "", err
	}
	absPath = filepath.Clean(absPath)
	coversDir, err := a.coversDir()
	if err != nil {
		return "", err
	}
	coversAbs, err := filepath.Abs(coversDir)
	if err != nil {
		return "", err
	}
	if absPath != coversAbs && !strings.HasPrefix(absPath, coversAbs+string(os.PathSeparator)) {
		return "", fmt.Errorf("путь к обложке вне разрешённой папки")
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("путь указывает на папку")
	}
	return absPath, nil
}

func (a *App) handleStream(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := a.validateStreamPath(rawPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	file, err := os.Open(absPath)
	if err != nil {
		http.Error(w, "Не удалось открыть файл", http.StatusNotFound)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		http.Error(w, "Не удалось получить информацию о файле", http.StatusInternalServerError)
		return
	}

	ext := strings.ToLower(filepath.Ext(absPath))
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		switch ext {
		case ".mp3":
			contentType = "audio/mpeg"
		case ".wav":
			contentType = "audio/wav"
		case ".ogg":
			contentType = "audio/ogg"
		case ".flac":
			contentType = "audio/flac"
		case ".m4a":
			contentType = "audio/mp4"
		case ".aac":
			contentType = "audio/aac"
		default:
			contentType = "application/octet-stream"
		}
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, filepath.Base(absPath), info.ModTime(), file)
}

func (a *App) handleCover(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := a.validateCoverPath(rawPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	http.ServeFile(w, r, absPath)
}

func (a *App) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Range, Content-Type")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
