package main

import (
	"encoding/json"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Word 是发给前端的一个词条。
type Word struct {
	ID    string   `json:"id"`
	En    string   `json:"en"`
	Zh    string   `json:"zh"`
	Tags  []string `json:"tags"`
	Image string   `json:"image,omitempty"`
	Audio string   `json:"audio,omitempty"`
}

// Category 是一个词类别,决定游戏里分成哪几关。
type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Icon  string `json:"icon"`
	Order int    `json:"order"`
}

// Manifest 是 /api/words/manifest 的响应。
// Sfx 只列出真实存在的音效文件,前端不去请求不存在的,省掉一堆 404;
// 缺的音效前端会用振荡器现场合成。
type Manifest struct {
	Words       []Word            `json:"words"`
	Categories  []Category        `json:"categories"`
	Sfx         map[string]string `json:"sfx"`
	GeneratedAt string            `json:"generatedAt"`
}

// 支持的音效名,对应 assets/sfx/<name>.mp3
var sfxNames = []string{"hit", "miss", "blank", "levelup"}

// wordMeta 是一个词的补充信息(中文释义 + 所属类别)。
type wordMeta struct {
	Zh   string   `json:"zh"`
	Tags []string `json:"tags"`
}

// wordsFile 是 assets/words.json 的格式:
//
//	{
//	  "categories": [ { "id": "fruit", "name": "水果", "icon": "🍎", "order": 1 } ],
//	  "words": { "apple": { "zh": "苹果", "tags": ["fruit"] } }
//	}
//
// 也兼容早期手写的扁平格式(顶层直接就是 id → wordMeta 的 map)。
type wordsFile struct {
	Categories []Category          `json:"categories"`
	Words      map[string]wordMeta `json:"words"`
}

// words.json 是后台唯一的可变状态,读写都过这把锁
var wordsFileMu sync.Mutex

func wordsFilePath(assetsDir string) string {
	return filepath.Join(assetsDir, "words.json")
}

// loadWordsFile 读词库元数据。文件不存在或坏掉都返回空结构,不让后台开不了。
func loadWordsFile(assetsDir string) wordsFile {
	out := wordsFile{Words: map[string]wordMeta{}}

	data, err := os.ReadFile(wordsFilePath(assetsDir))
	if err != nil {
		return out
	}

	// 先看顶层有没有 words 键,以此区分新旧格式
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(data, &probe); err != nil {
		log.Printf("words.json 解析失败,中文释义和类别会缺失: %v", err)
		return out
	}

	if _, isNew := probe["words"]; isNew {
		if err := json.Unmarshal(data, &out); err != nil {
			log.Printf("words.json 解析失败: %v", err)
			return wordsFile{Words: map[string]wordMeta{}}
		}
		if out.Words == nil {
			out.Words = map[string]wordMeta{}
		}
		return out
	}

	// 旧的扁平格式:{ "apple": { "zh": "苹果", "tags": ["fruit"] } }
	flat := map[string]wordMeta{}
	if err := json.Unmarshal(data, &flat); err != nil {
		log.Printf("words.json 解析失败: %v", err)
		return out
	}
	out.Words = flat
	return out
}

// saveWordsFile 原子写入:先写临时文件再 rename,避免写到一半断电留下半个文件。
func saveWordsFile(assetsDir string, wf wordsFile) error {
	if wf.Words == nil {
		wf.Words = map[string]wordMeta{}
	}
	if wf.Categories == nil {
		wf.Categories = []Category{}
	}
	sort.SliceStable(wf.Categories, func(i, j int) bool {
		return wf.Categories[i].Order < wf.Categories[j].Order
	})

	data, err := json.MarshalIndent(wf, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	path := wordsFilePath(assetsDir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// 同一个词有多种格式时按这个顺序挑,越靠前越优先。
var imageExts = []string{".webp", ".png", ".svg", ".jpg", ".jpeg", ".gif"}
var audioExts = []string{".mp3", ".m4a", ".aac", ".ogg", ".wav"}

// scanAssets 扫描 images/ 和 audio/,取文件名交集生成词库。
// 只有图和音频都齐了的词才进游戏,缺一半的会作为 warning 返回,启动时打在日志里。
func scanAssets(assetsDir string) (Manifest, []string) {
	images := collect(filepath.Join(assetsDir, "images"), imageExts)
	audios := collect(filepath.Join(assetsDir, "audio"), audioExts)

	wordsFileMu.Lock()
	wf := loadWordsFile(assetsDir)
	wordsFileMu.Unlock()
	meta := wf.Words

	var warnings []string
	ids := make([]string, 0, len(images))
	for id := range images {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	words := make([]Word, 0, len(ids))
	for _, id := range ids {
		audioFile, ok := audios[id]
		if !ok {
			warnings = append(warnings, "缺音频,已跳过: images/"+images[id]+" (需要 audio/"+id+".mp3)")
			continue
		}
		m := meta[id]
		tags := m.Tags
		if len(tags) == 0 {
			tags = []string{"other"}
		}
		words = append(words, Word{
			ID:    id,
			En:    strings.ReplaceAll(id, "-", " "),
			Zh:    m.Zh,
			Tags:  tags,
			Image: assetURL("images", images[id]),
			Audio: assetURL("audio", audioFile),
		})
	}

	extraIDs := make([]string, 0)
	for id := range audios {
		if _, ok := images[id]; !ok {
			extraIDs = append(extraIDs, id)
		}
	}
	sort.Strings(extraIDs)
	for _, id := range extraIDs {
		warnings = append(warnings, "缺图片,已跳过: audio/"+audios[id]+" (需要 images/"+id+".webp)")
	}

	sfxFiles := collect(filepath.Join(assetsDir, "sfx"), audioExts)
	sfx := map[string]string{}
	for _, name := range sfxNames {
		if f, ok := sfxFiles[name]; ok {
			sfx[name] = assetURL("sfx", f)
		}
	}

	return Manifest{
		Words:       words,
		Categories:  resolveCategories(wf.Categories, words),
		Sfx:         sfx,
		GeneratedAt: time.Now().Format(time.RFC3339),
	}, warnings
}

// resolveCategories 把声明过的类别按 order 排好,再把词里用到、但没声明过的 tag
// 补成一个同名类别 —— 手写 words.json 只填了 tags 没建类别时,关卡照样出得来。
func resolveCategories(declared []Category, words []Word) []Category {
	out := make([]Category, 0, len(declared))
	seen := map[string]bool{}
	for _, c := range declared {
		if c.ID == "" || seen[c.ID] {
			continue
		}
		seen[c.ID] = true
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Order < out[j].Order })

	extra := make([]string, 0)
	for _, w := range words {
		for _, tag := range w.Tags {
			if tag != "" && !seen[tag] {
				seen[tag] = true
				extra = append(extra, tag)
			}
		}
	}
	sort.Strings(extra)
	for i, tag := range extra {
		// 名字和图标留空,前端会退回它内置的中文名/emoji 对照表
		out = append(out, Category{ID: tag, Order: len(out) + i + 1000})
	}
	return out
}

// collect 返回 词 id -> 文件名。同名多格式时按 exts 的顺序取优先级最高的。
func collect(dir string, exts []string) map[string]string {
	out := map[string]string{}
	rank := map[string]int{}
	for i, e := range exts {
		rank[e] = i
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		ext := strings.ToLower(filepath.Ext(name))
		r, ok := rank[ext]
		if !ok {
			continue
		}
		id := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
		if prev, exists := out[id]; exists && rank[strings.ToLower(filepath.Ext(prev))] <= r {
			continue
		}
		out[id] = name
	}
	return out
}

// 文件名里有空格或中文时也要能正确取到
func assetURL(sub, file string) string {
	u := url.URL{Path: "/assets/" + sub + "/" + file}
	return u.String()
}
