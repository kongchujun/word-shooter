# 素材目录

把图片和音频丢进来,后端会自动扫描配对,**不用改代码**。

```
images/apple.webp     ┐ 文件名必须一致(小写,词组用连字符)
audio/apple.mp3       ┘
sfx/hit.mp3           可选:hit / miss / blank / levelup,没有就用代码合成的音效
words.json            可选:中文释义和分类
```

- **图片**:WebP 有损 q80、带透明通道、512×512、背景抠掉,单张 < 50KB。也支持 png/svg/jpg/gif。
- **音频**:MP3、64–128kbps 单声道、1~2 秒、前后不留静音。也支持 m4a/aac/ogg/wav。

只有图或只有音频的文件会被跳过,启动日志里会写明缺哪个。

`words.json` 长这样(可以只写一部分词):

```json
{
  "apple":  { "zh": "苹果", "tags": ["fruit"] },
  "banana": { "zh": "香蕉", "tags": ["fruit"] },
  "cat":    { "zh": "猫",   "tags": ["animal"] }
}
```

`tags` 的第一个决定进哪一关,同一个 tag 攒够 4 个词就自动成关。不写 tags 的词归到「综合」。

这个目录空着也没关系 —— 前端会退回内置的 emoji 占位词库,游戏照样能玩。
