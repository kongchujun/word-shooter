package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// 词 id 白名单。这是最重要的一道防线 —— 没有它,id 传 "../../.env"
// 就能覆盖掉二进制旁边的密钥文件。
var idRe = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

// 单个上传/生成文件的大小上限
const maxUploadBytes = 5 << 20

// adminServer 持有后台要用到的上下文。
type adminServer struct {
	assetsDir string
}

func registerAdminRoutes(mux *http.ServeMux, assetsDir string) {
	s := &adminServer{assetsDir: assetsDir}

	// me 不需要登录 —— 前端靠它判断该不该显示登录框
	mux.HandleFunc("GET /api/admin/me", handleMe)
	mux.HandleFunc("POST /api/admin/login", handleLogin)
	mux.HandleFunc("POST /api/admin/logout", handleLogout)

	mux.HandleFunc("GET /api/admin/data", requireAdmin(s.handleData))
	mux.HandleFunc("PUT /api/admin/categories", requireAdmin(s.handleSaveCategories))
	// 手动上传和 AI 生成走同一条路:前端把文件读成 base64,预览确认后一起提交给 save
	mux.HandleFunc("POST /api/admin/save", requireAdmin(s.handleSaveWord))
	mux.HandleFunc("DELETE /api/admin/words/{id}", requireAdmin(s.handleDeleteWord))

	mux.HandleFunc("POST /api/admin/generate/image", requireAdmin(s.handleGenerateImage))
	mux.HandleFunc("POST /api/admin/generate/audio", requireAdmin(s.handleGenerateAudio))
	mux.HandleFunc("GET /api/admin/settings", requireAdmin(s.handleGetSettings))
	mux.HandleFunc("PUT /api/admin/settings", requireAdmin(s.handleSaveSettings))
	mux.HandleFunc("GET /api/admin/models", requireAdmin(s.handleModels))
}

// ---------- AI 生成 ----------

// 生成结果只回给浏览器预览,不落盘。满意了再调 /api/admin/save 写文件 ——
// 这样反复重生成也不会在 assets 里留一堆垃圾。
func (s *adminServer) handleGenerateImage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Word   string `json:"word"`
		Prompt string `json:"prompt"`
	}
	if err := decodeJSON(w, r, &req, 64<<10); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	word := strings.TrimSpace(req.Word)
	if word == "" {
		jsonError(w, http.StatusBadRequest, "缺少单词")
		return
	}

	cfg := loadSettings(s.assetsDir)
	if p := strings.TrimSpace(req.Prompt); p != "" {
		cfg.ImagePrompt = p // 本次生成临时覆盖,不写进设置
	}

	g, err := generateImage(r.Context(), cfg, word)
	if err != nil {
		log.Printf("[admin] 生成图片失败 word=%q: %v", word, err)
		jsonError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"b64":       base64.StdEncoding.EncodeToString(g.Data),
		"mediaType": g.MediaType,
		"bytes":     len(g.Data),
		"cost":      g.Cost,
		"model":     g.Model,
	})
}

func (s *adminServer) handleGenerateAudio(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Word  string `json:"word"`
		Voice string `json:"voice"`
	}
	if err := decodeJSON(w, r, &req, 16<<10); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	word := strings.TrimSpace(req.Word)
	if word == "" {
		jsonError(w, http.StatusBadRequest, "缺少单词")
		return
	}

	cfg := loadSettings(s.assetsDir)
	if v := strings.TrimSpace(req.Voice); v != "" {
		cfg.TTSVoice = v
	}

	g, err := generateSpeech(r.Context(), cfg, word)
	if err != nil {
		log.Printf("[admin] 生成语音失败 word=%q: %v", word, err)
		jsonError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"b64":       base64.StdEncoding.EncodeToString(g.Data),
		"mediaType": g.MediaType,
		"bytes":     len(g.Data),
		"cost":      g.Cost,
		"model":     g.Model,
	})
}

// ---------- 设置 ----------

func (s *adminServer) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, loadSettings(s.assetsDir))
}

func (s *adminServer) handleSaveSettings(w http.ResponseWriter, r *http.Request) {
	var cfg Settings
	if err := decodeJSON(w, r, &cfg, 64<<10); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := saveSettings(s.assetsDir, cfg); err != nil {
		jsonError(w, http.StatusInternalServerError, "写 settings.json 失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, loadSettings(s.assetsDir))
}

// handleModels 列可用的图片模型和 TTS 模型(带音色)。
// 拉不到不算错误 —— 返回空列表,前端退回手填模型 id。
func (s *adminServer) handleModels(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"image": []orModel{}, "speech": []orModel{}}
	var errs []string

	for _, m := range []string{"image", "speech"} {
		models, err := listModels(r.Context(), m)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		out[m] = models
	}
	if len(errs) > 0 {
		out["warning"] = strings.Join(errs, "; ")
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------- 读 ----------

type adminWord struct {
	ID    string   `json:"id"`
	Zh    string   `json:"zh"`
	Tags  []string `json:"tags"`
	Image string   `json:"image,omitempty"`
	Audio string   `json:"audio,omitempty"`
}

// handleData 把类别和所有词条(含只有一半素材的)都给前端。
// 注意和 /api/words/manifest 不同:那边只给图音齐全的词,这边要显示缺素材的以便补齐。
func (s *adminServer) handleData(w http.ResponseWriter, r *http.Request) {
	wordsFileMu.Lock()
	wf := loadWordsFile(s.assetsDir)
	wordsFileMu.Unlock()

	images := collect(filepath.Join(s.assetsDir, "images"), imageExts)
	audios := collect(filepath.Join(s.assetsDir, "audio"), audioExts)

	ids := map[string]bool{}
	for id := range images {
		ids[id] = true
	}
	for id := range audios {
		ids[id] = true
	}
	for id := range wf.Words {
		ids[id] = true
	}

	sorted := make([]string, 0, len(ids))
	for id := range ids {
		sorted = append(sorted, id)
	}
	sort.Strings(sorted)

	words := make([]adminWord, 0, len(sorted))
	for _, id := range sorted {
		m := wf.Words[id]
		aw := adminWord{ID: id, Zh: m.Zh, Tags: m.Tags}
		if aw.Tags == nil {
			aw.Tags = []string{}
		}
		if f, ok := images[id]; ok {
			aw.Image = assetURL("images", f)
		}
		if f, ok := audios[id]; ok {
			aw.Audio = assetURL("audio", f)
		}
		words = append(words, aw)
	}

	cats := wf.Categories
	if cats == nil {
		cats = []Category{}
	}
	sort.SliceStable(cats, func(i, j int) bool { return cats[i].Order < cats[j].Order })

	writeJSON(w, http.StatusOK, map[string]any{"categories": cats, "words": words})
}

// ---------- 类别 ----------

// handleSaveCategories 整表提交:增删改排序一次搞定,不用为每个动作开一个接口。
func (s *adminServer) handleSaveCategories(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Categories []Category `json:"categories"`
	}
	if err := decodeJSON(w, r, &req, 256<<10); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	seen := map[string]bool{}
	clean := make([]Category, 0, len(req.Categories))
	for i, c := range req.Categories {
		c.ID = strings.TrimSpace(c.ID)
		c.Name = strings.TrimSpace(c.Name)
		c.Icon = strings.TrimSpace(c.Icon)
		if !idRe.MatchString(c.ID) {
			jsonError(w, http.StatusBadRequest,
				fmt.Sprintf("类别 id %q 不合法:只能用小写字母开头,后面接小写字母、数字或连字符", c.ID))
			return
		}
		if seen[c.ID] {
			jsonError(w, http.StatusBadRequest, "类别 id 重复: "+c.ID)
			return
		}
		seen[c.ID] = true
		if c.Name == "" {
			c.Name = c.ID
		}
		c.Order = i + 1
		clean = append(clean, c)
	}

	wordsFileMu.Lock()
	defer wordsFileMu.Unlock()
	wf := loadWordsFile(s.assetsDir)
	wf.Categories = clean
	if err := saveWordsFile(s.assetsDir, wf); err != nil {
		jsonError(w, http.StatusInternalServerError, "写 words.json 失败: "+err.Error())
		return
	}
	log.Printf("[admin] 保存类别 %d 个", len(clean))
	writeJSON(w, http.StatusOK, map[string]any{"categories": clean})
}

// ---------- 词条 ----------

type saveWordReq struct {
	ID   string   `json:"id"`
	Zh   string   `json:"zh"`
	Tags []string `json:"tags"`
	// 可选,base64(不带 data: 前缀)。给了才写文件,没给就只改元数据。
	ImageB64  string `json:"imageB64"`
	ImageType string `json:"imageType"`
	AudioB64  string `json:"audioB64"`
	AudioType string `json:"audioType"`
}

func (s *adminServer) handleSaveWord(w http.ResponseWriter, r *http.Request) {
	var req saveWordReq
	if err := decodeJSON(w, r, &req, 2*maxUploadBytes); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	id := strings.ToLower(strings.TrimSpace(req.ID))
	if !idRe.MatchString(id) {
		jsonError(w, http.StatusBadRequest,
			"单词 id 不合法:只能用小写字母开头,后面接小写字母、数字或连字符(词组用 ice-cream 这种写法)")
		return
	}

	if req.ImageB64 != "" {
		ext := extForMedia(req.ImageType, imageExts, ".webp")
		if err := s.writeAsset("images", id, ext, req.ImageB64, imageExts); err != nil {
			jsonError(w, http.StatusBadRequest, "写图片失败: "+err.Error())
			return
		}
	}
	if req.AudioB64 != "" {
		ext := extForMedia(req.AudioType, audioExts, ".mp3")
		if err := s.writeAsset("audio", id, ext, req.AudioB64, audioExts); err != nil {
			jsonError(w, http.StatusBadRequest, "写音频失败: "+err.Error())
			return
		}
	}

	wordsFileMu.Lock()
	defer wordsFileMu.Unlock()
	wf := loadWordsFile(s.assetsDir)
	tags := req.Tags
	if tags == nil {
		tags = []string{}
	}
	wf.Words[id] = wordMeta{Zh: strings.TrimSpace(req.Zh), Tags: tags}
	if err := saveWordsFile(s.assetsDir, wf); err != nil {
		jsonError(w, http.StatusInternalServerError, "写 words.json 失败: "+err.Error())
		return
	}
	log.Printf("[admin] 保存词条 %s (图=%v 音=%v)", id, req.ImageB64 != "", req.AudioB64 != "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

func (s *adminServer) handleDeleteWord(w http.ResponseWriter, r *http.Request) {
	id := strings.ToLower(strings.TrimSpace(r.PathValue("id")))
	if !idRe.MatchString(id) {
		jsonError(w, http.StatusBadRequest, "单词 id 不合法")
		return
	}

	removed := 0
	for _, sub := range []struct {
		dir  string
		exts []string
	}{{"images", imageExts}, {"audio", audioExts}} {
		for _, ext := range sub.exts {
			p := filepath.Join(s.assetsDir, sub.dir, id+ext)
			if err := os.Remove(p); err == nil {
				removed++
			}
		}
	}

	wordsFileMu.Lock()
	defer wordsFileMu.Unlock()
	wf := loadWordsFile(s.assetsDir)
	delete(wf.Words, id)
	if err := saveWordsFile(s.assetsDir, wf); err != nil {
		jsonError(w, http.StatusInternalServerError, "写 words.json 失败: "+err.Error())
		return
	}
	log.Printf("[admin] 删除词条 %s,连带删掉 %d 个文件", id, removed)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "filesRemoved": removed})
}

// ---------- 落盘 ----------

func (s *adminServer) writeAsset(sub, id, ext, b64 string, exts []string) error {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return fmt.Errorf("base64 解码失败: %w", err)
	}
	if len(data) > maxUploadBytes {
		return fmt.Errorf("文件太大(%d 字节,上限 5MB)", len(data))
	}
	return s.replaceAsset(sub, id, ext, data, exts)
}

// replaceAsset 写入前先删掉这个词的其它扩展名版本,
// 否则换格式后会同时留下 apple.png 和 apple.webp,扫描时看到的还是旧的那个。
func (s *adminServer) replaceAsset(sub, id, ext string, data []byte, exts []string) error {
	dir := filepath.Join(s.assetsDir, sub)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, e := range exts {
		if e != ext {
			os.Remove(filepath.Join(dir, id+e))
		}
	}
	tmp := filepath.Join(dir, id+ext+".tmp")
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, id+ext))
}

// ---------- 小工具 ----------

func decodeJSON(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return fmt.Errorf("请求格式错误: %w", err)
	}
	return nil
}

// extForMedia 把 MIME 类型转成扩展名,认不出来就用默认值
func extForMedia(mediaType string, allowed []string, fallback string) string {
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if i := strings.Index(mediaType, ";"); i >= 0 {
		mediaType = mediaType[:i]
	}
	switch mediaType {
	case "image/webp":
		return ".webp"
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/svg+xml":
		return ".svg"
	case "image/gif":
		return ".gif"
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/mp4", "audio/m4a", "audio/x-m4a":
		return ".m4a"
	case "audio/aac":
		return ".aac"
	case "audio/ogg":
		return ".ogg"
	case "audio/wav", "audio/x-wav":
		return ".wav"
	}
	if slicesContains(allowed, fallback) {
		return fallback
	}
	return allowed[0]
}

func slicesContains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
