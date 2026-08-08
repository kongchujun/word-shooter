package server

import (
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"

	"word-shooter/internal/config"
	"word-shooter/internal/media"
	"word-shooter/internal/store"
)

// 词 id 白名单。这是最重要的一道防线 —— 没有它,id 传 "../../.env"
// 就能覆盖掉二进制旁边的密钥文件。
var idRe = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

// 单个生成/上传素材的大小上限
const maxAssetBytes = 5 << 20

// ---------- 状态 ----------

func (s *Server) handleMe(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"enabled":    s.auth.enabled(),
		"loggedIn":   s.auth.enabled() && s.auth.loggedIn(c),
		"username":   s.cfg.AdminUser,
		"openrouter": s.cfg.OpenRouterEnabled(),
		"azure":      s.cfg.AzureEnabled(),
	})
}

// ---------- 词条读取 ----------

type adminWord struct {
	ID    string   `json:"id"`
	Zh    string   `json:"zh"`
	Tags  []string `json:"tags"`
	Image string   `json:"image,omitempty"`
	Audio string   `json:"audio,omitempty"`
}

// handleData 把类别和所有词条(含只有一半素材的)都给前端。
// 和 /api/words/manifest 不同:那边只给图音齐全的词,这边要显示缺素材的以便补齐。
func (s *Server) handleData(c *gin.Context) {
	meta, cats := s.words.LoadMeta()
	images, audios := s.words.Files()

	ids := map[string]bool{}
	for id := range images {
		ids[id] = true
	}
	for id := range audios {
		ids[id] = true
	}
	for id := range meta {
		ids[id] = true
	}

	sorted := make([]string, 0, len(ids))
	for id := range ids {
		sorted = append(sorted, id)
	}
	sort.Strings(sorted)

	words := make([]adminWord, 0, len(sorted))
	for _, id := range sorted {
		m := meta[id]
		aw := adminWord{ID: id, Zh: m.Zh, Tags: m.Tags}
		if aw.Tags == nil {
			aw.Tags = []string{}
		}
		if f, ok := images[id]; ok {
			aw.Image = store.AssetURL("images", f)
		}
		if f, ok := audios[id]; ok {
			aw.Audio = store.AssetURL("audio", f)
		}
		words = append(words, aw)
	}

	if cats == nil {
		cats = []store.Category{}
	}
	sort.SliceStable(cats, func(i, j int) bool { return cats[i].Order < cats[j].Order })

	c.JSON(http.StatusOK, gin.H{"categories": cats, "words": words})
}

// ---------- 类别 ----------

// handleSaveCategories 整表提交:增删改排序一次搞定,不用为每个动作开一个接口。
func (s *Server) handleSaveCategories(c *gin.Context) {
	var req struct {
		Categories []store.Category `json:"categories"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		abortJSON(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}

	seen := map[string]bool{}
	clean := make([]store.Category, 0, len(req.Categories))
	for i, cat := range req.Categories {
		cat.ID = strings.TrimSpace(cat.ID)
		cat.Name = strings.TrimSpace(cat.Name)
		cat.Icon = strings.TrimSpace(cat.Icon)
		if !idRe.MatchString(cat.ID) {
			abortJSON(c, http.StatusBadRequest,
				fmt.Sprintf("类别 id %q 不合法:只能用小写字母开头,后面接小写字母、数字或连字符", cat.ID))
			return
		}
		if seen[cat.ID] {
			abortJSON(c, http.StatusBadRequest, "类别 id 重复: "+cat.ID)
			return
		}
		seen[cat.ID] = true
		if cat.Name == "" {
			cat.Name = cat.ID
		}
		cat.Order = i + 1
		clean = append(clean, cat)
	}

	if err := s.words.SaveCategories(clean); err != nil {
		abortJSON(c, http.StatusInternalServerError, "写 words.json 失败: "+err.Error())
		return
	}
	log.Printf("[admin] 保存类别 %d 个", len(clean))
	c.JSON(http.StatusOK, gin.H{"categories": clean})
}

// ---------- 词条写入 ----------

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

func (s *Server) handleSaveWord(c *gin.Context) {
	var req saveWordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		abortJSON(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}

	id := strings.ToLower(strings.TrimSpace(req.ID))
	if !idRe.MatchString(id) {
		abortJSON(c, http.StatusBadRequest,
			"单词 id 不合法:只能用小写字母开头,后面接小写字母、数字或连字符(词组用 ice-cream 这种写法)")
		return
	}

	if req.ImageB64 != "" {
		ext := extForMedia(req.ImageType, store.ImageExts, ".webp")
		if err := s.writeAsset("images", id, ext, req.ImageB64, store.ImageExts); err != nil {
			abortJSON(c, http.StatusBadRequest, "写图片失败: "+err.Error())
			return
		}
	}
	if req.AudioB64 != "" {
		ext := extForMedia(req.AudioType, store.AudioExts, ".mp3")
		if err := s.writeAsset("audio", id, ext, req.AudioB64, store.AudioExts); err != nil {
			abortJSON(c, http.StatusBadRequest, "写音频失败: "+err.Error())
			return
		}
	}

	tags := req.Tags
	if tags == nil {
		tags = []string{}
	}
	if err := s.words.SaveWord(id, store.Meta{Zh: strings.TrimSpace(req.Zh), Tags: tags}); err != nil {
		abortJSON(c, http.StatusInternalServerError, "写 words.json 失败: "+err.Error())
		return
	}
	log.Printf("[admin] 保存词条 %s (图=%v 音=%v)", id, req.ImageB64 != "", req.AudioB64 != "")
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id})
}

func (s *Server) handleDeleteWord(c *gin.Context) {
	id := strings.ToLower(strings.TrimSpace(c.Param("id")))
	if !idRe.MatchString(id) {
		abortJSON(c, http.StatusBadRequest, "单词 id 不合法")
		return
	}

	removed := 0
	for _, sub := range []struct {
		dir  string
		exts []string
	}{{"images", store.ImageExts}, {"audio", store.AudioExts}} {
		for _, ext := range sub.exts {
			if err := os.Remove(filepath.Join(s.words.Dir(), sub.dir, id+ext)); err == nil {
				removed++
			}
		}
	}

	if err := s.words.DeleteWord(id); err != nil {
		abortJSON(c, http.StatusInternalServerError, "写 words.json 失败: "+err.Error())
		return
	}
	log.Printf("[admin] 删除词条 %s,连带删掉 %d 个文件", id, removed)
	c.JSON(http.StatusOK, gin.H{"ok": true, "filesRemoved": removed})
}

// ---------- AI 生成 ----------

// 生成结果只回给浏览器预览,不落盘。满意了再调 /api/admin/save 写文件 ——
// 这样反复重生成也不会在 assets 里留一堆垃圾。
func (s *Server) handleGenerateImage(c *gin.Context) {
	var req struct {
		Word   string `json:"word"`
		Prompt string `json:"prompt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		abortJSON(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	word := strings.TrimSpace(req.Word)
	if word == "" {
		abortJSON(c, http.StatusBadRequest, "缺少单词")
		return
	}

	cfg := s.settings.Load()
	if p := strings.TrimSpace(req.Prompt); p != "" {
		cfg.ImagePrompt = p // 本次生成临时覆盖,不写进设置
	}

	g, err := s.openRouter.GenerateImage(c.Request.Context(), cfg, word)
	if err != nil {
		log.Printf("[admin] 生成图片失败 word=%q: %v", word, err)
		abortJSON(c, http.StatusBadGateway, err.Error())
		return
	}
	c.JSON(http.StatusOK, generatedResponse(g))
}

func (s *Server) handleGenerateAudio(c *gin.Context) {
	var req struct {
		Word  string `json:"word"`
		Voice string `json:"voice"`
		// 空 = 用设置里的默认语音源;openrouter / azure = 本次临时指定
		Provider string `json:"provider"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		abortJSON(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	word := strings.TrimSpace(req.Word)
	if word == "" {
		abortJSON(c, http.StatusBadRequest, "缺少单词")
		return
	}

	cfg := s.settings.Load()
	provider := strings.TrimSpace(req.Provider)
	// 音色写进哪个字段,取决于这次走哪个源 —— 两边的音色名互不通用
	if v := strings.TrimSpace(req.Voice); v != "" {
		if provider == config.TTSAzure || (provider == "" && cfg.TTSProvider == config.TTSAzure) {
			cfg.AzureVoice = v
		} else {
			cfg.TTSVoice = v
		}
	}

	g, err := s.tts.Synthesize(c.Request.Context(), cfg, word, provider)
	if err != nil {
		log.Printf("[admin] 生成语音失败 word=%q provider=%q: %v", word, provider, err)
		abortJSON(c, http.StatusBadGateway, err.Error())
		return
	}
	c.JSON(http.StatusOK, generatedResponse(g))
}

func generatedResponse(g *media.Generated) gin.H {
	return gin.H{
		"b64":       base64.StdEncoding.EncodeToString(g.Data),
		"mediaType": g.MediaType,
		"bytes":     len(g.Data),
		"cost":      g.Cost,
		"model":     g.Model,
	}
}

// ---------- 设置与模型 ----------

func (s *Server) handleGetSettings(c *gin.Context) {
	c.JSON(http.StatusOK, s.settings.Load())
}

func (s *Server) handleSaveSettings(c *gin.Context) {
	var cfg config.Settings
	if err := c.ShouldBindJSON(&cfg); err != nil {
		abortJSON(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	if err := s.settings.Save(cfg); err != nil {
		abortJSON(c, http.StatusInternalServerError, "写 settings.json 失败: "+err.Error())
		return
	}
	c.JSON(http.StatusOK, s.settings.Load())
}

// handleModels 列可用的图片模型、OpenRouter TTS 模型和 Azure 音色。
// 拉不到不算错误 —— 返回空列表,前端退回手填。
func (s *Server) handleModels(c *gin.Context) {
	ctx := c.Request.Context()
	cfg := s.settings.Load()

	out := gin.H{
		"image":     []media.Model{},
		"speech":    []media.Model{},
		"azure":     []media.Model{},
		"providers": s.tts.Providers(cfg),
	}
	var errs []string

	for _, modality := range []string{"image", "speech"} {
		models, err := s.openRouter.ListModels(ctx, modality)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		out[modality] = models
	}

	if s.cfg.AzureEnabled() {
		voices, err := s.tts.AzureVoices(ctx)
		if err != nil {
			errs = append(errs, err.Error())
		} else {
			out["azure"] = voices
		}
	}

	if len(errs) > 0 {
		out["warning"] = strings.Join(errs, "; ")
	}
	c.JSON(http.StatusOK, out)
}

// ---------- 素材落盘 ----------

func (s *Server) writeAsset(sub, id, ext, b64 string, exts []string) error {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return fmt.Errorf("base64 解码失败: %w", err)
	}
	if len(data) > maxAssetBytes {
		return fmt.Errorf("文件太大(%d 字节,上限 5MB)", len(data))
	}
	return s.replaceAsset(sub, id, ext, data, exts)
}

// replaceAsset 写入前先删掉这个词的其它扩展名版本,
// 否则换格式后会同时留下 apple.png 和 apple.webp,扫描时看到的还是旧的那个。
func (s *Server) replaceAsset(sub, id, ext string, data []byte, exts []string) error {
	dir := filepath.Join(s.words.Dir(), sub)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("建目录: %w", err)
	}
	for _, e := range exts {
		if e != ext {
			os.Remove(filepath.Join(dir, id+e))
		}
	}
	tmp := filepath.Join(dir, id+ext+".tmp")
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("写临时文件: %w", err)
	}
	if err := os.Rename(tmp, filepath.Join(dir, id+ext)); err != nil {
		return fmt.Errorf("替换素材文件: %w", err)
	}
	return nil
}

// extForMedia 把 MIME 类型转成扩展名,认不出来就用默认值。
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
	for _, e := range allowed {
		if e == fallback {
			return fallback
		}
	}
	return allowed[0]
}
