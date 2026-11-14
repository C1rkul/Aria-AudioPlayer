package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Мониторинг папок библиотеки: следим за файлами на диске и шлём фронтенду
// событие "library:changed" (с дебаунсом), когда пора пересобрать библиотеку.

var (
	watchMu        sync.Mutex
	watcher        *fsnotify.Watcher
	watchTimer     *time.Timer
	watchEvtCtxSet = map[string]bool{}
)

// watchRoots — папки под наблюдением. Только явно подключённые папки
// (settings.localFolders): список виден в интерфейсе и управляется оттуда же,
// ничего не подтягивается молча.
func (a *App) watchRoots() []string {
	seen := map[string]bool{}
	var roots []string
	for _, p := range a.settings.LocalFolders {
		if p == "" {
			continue
		}
		p = filepath.Clean(p)
		if p != "." && !seen[p] {
			seen[p] = true
			roots = append(roots, p)
		}
	}
	sort.Strings(roots)
	return roots
}

// GetWatchFolders — подключённые папки библиотеки (для списка в интерфейсе).
func (a *App) GetWatchFolders() []string {
	roots := a.watchRoots()
	out := make([]string, len(roots))
	copy(out, roots)
	return out
}

// RemoveLocalFolder убирает папку из мониторинга и удаляет её треки из
// библиотеки. Текущий список треков передаёт фронтенд (без гонки с сохранением),
// отфильтрованный результат сразу пишется на диск.
func (a *App) RemoveLocalFolder(folder string, current []Track) ([]Track, error) {
	clean := filepath.Clean(folder)
	keptFolders := make([]string, 0, len(a.settings.LocalFolders))
	for _, p := range a.settings.LocalFolders {
		if filepath.Clean(p) != clean {
			keptFolders = append(keptFolders, p)
		}
	}
	a.settings.LocalFolders = keptFolders
	_ = a.saveSettingsInternal(a.settings)

	under := func(p string) bool {
		rel, err := filepath.Rel(clean, filepath.Clean(p))
		if err != nil {
			return false
		}
		return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
	}
	out := make([]Track, 0, len(current))
	for _, t := range current {
		if t.Path != "" && under(t.Path) {
			continue
		}
		out = append(out, t)
	}
	_ = a.SaveTracks(out) // диск сразу согласован — watch/rescan не воскресит треки
	_ = a.StartWatch()
	return out, nil
}

// StartWatch (пере)запускает наблюдение за папками библиотеки.
func (a *App) StartWatch() error {
	roots := a.watchRoots()

	watchMu.Lock()
	defer watchMu.Unlock()

	if watcher != nil {
		_ = watcher.Close()
		watcher = nil
	}
	if len(roots) == 0 {
		return nil
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("fsnotify: %w", err)
	}
	for _, root := range roots {
		addWatchRecursive(w, root)
	}
	watcher = w
	watchEvtCtxSet = map[string]bool{}

	go func(w *fsnotify.Watcher) {
		for {
			select {
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if ev.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) == 0 {
					continue
				}
				// новая подпапка — включить её в наблюдение
				if ev.Op&fsnotify.Create != 0 {
					if fi, err := os.Stat(ev.Name); err == nil && fi.IsDir() {
						addWatchRecursive(w, ev.Name)
					}
				}
				scheduleLibraryChanged(a)
			case _, ok := <-w.Errors:
				if !ok {
					return
				}
			}
		}
	}(w)

	fmt.Printf("👁️ Мониторинг папок запущен: %d шт.\n", len(roots))
	return nil
}

// addWatchRecursive добавляет watchers для root и всех подпапок.
func addWatchRecursive(w *fsnotify.Watcher, root string) {
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // папку удалили/нет доступа — просто пропускаем
		}
		if d.IsDir() {
			_ = w.Add(path)
		}
		return nil
	})
}

// scheduleLibraryChanged — дебаунс: серия событий (копирование, запись тегов)
// превращается в одно событие library:changed через 700 мс после последнего.
func scheduleLibraryChanged(a *App) {
	watchMu.Lock()
	defer watchMu.Unlock()
	if watchTimer != nil {
		watchTimer.Stop()
	}
	watchTimer = time.AfterFunc(700*time.Millisecond, func() {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "library:changed")
		}
	})
}

// RescanWatchedFolders пересканировывает наблюдаемые папки по актуальному
// списку треков из фронтенда (текущий список передаём — без гонки с записью).
// Существующие треки сохраняют ID и метаданные; новые файлы разбираются
// полностью; пропавшие с диска — удаляются.
func (a *App) RescanWatchedFolders(current []Track) ([]Track, error) {
	roots := a.watchRoots()
	if len(roots) == 0 {
		return current, nil
	}
	if current == nil {
		var err error
		current, err = a.LoadTracks()
		if err != nil {
			return nil, err
		}
	}

	// все аудиофайлы на диске под корнями
	onDisk := map[string]bool{}
	for _, root := range roots {
		_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if allowedAudioExtensions[strings.ToLower(filepath.Ext(path))] {
				onDisk[filepath.Clean(path)] = true
			}
			return nil
		})
	}

	underRoot := func(p string) bool {
		cp := filepath.Clean(p)
		for _, root := range roots {
			rel, err := filepath.Rel(root, cp)
			if err != nil {
				continue
			}
			if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				continue
			}
			return true
		}
		return false
	}

	// существующие треки: под корнями — только если файл ещё на диске;
	// остальные (добавленные по файлу) — не трогаем
	seen := map[string]bool{}
	out := make([]Track, 0, len(current))
	for _, t := range current {
		if t.Path == "" {
			out = append(out, t)
			continue
		}
		cp := filepath.Clean(t.Path)
		if seen[cp] {
			continue
		}
		if underRoot(t.Path) && !onDisk[cp] {
			continue // файла больше нет
		}
		seen[cp] = true
		out = append(out, t)
	}

	// новые файлы (в детерминированном порядке)
	var added []string
	for p := range onDisk {
		if !seen[p] {
			added = append(added, p)
		}
	}
	sort.Strings(added)
	for _, p := range added {
		id := generateID()
		title, artist, album, coverPath := a.extractMetadataSafe(p, id)
		if strings.TrimSpace(title) == "" {
			title = filepath.Base(p)
		}
		out = append(out, Track{
			ID:        id,
			Title:     title,
			Artist:    artist,
			Album:     album,
			Path:      p,
			Source:    "local",
			CoverPath: coverPath,
			Duration:  0,
		})
	}
	return out, nil
}
