export type AnimatedEmojiPack = 'noto' | 'fluent'

export interface AnimatedEmojiItem {
  code: string
  pack: AnimatedEmojiPack
  label: string
  keywords: string
  fallback: string
  url: string
}

export interface StandardEmojiItem {
  emoji: string
  label: string
  keywords: string
}

export interface StandardEmojiGroup {
  id: string
  label: string
  icon: string
  items: readonly StandardEmojiItem[]
}

const RECENT_EMOJIS_STORAGE_KEY = 'do-it-laaaaaater.blog.recent-emojis.v1'
const MAX_RECENT_EMOJIS = 16

function buildNotoUrl(codepoint: string): string {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/512.webp`
}

function buildFluentUrl(folder: string, filename: string): string {
  return `https://cdn.jsdelivr.net/gh/Tarikul-Islam-Anik/Animated-Fluent-Emojis@master/Emojis/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`
}

type RawNotoTuple = readonly [
  slug: string,
  codepoint: string,
  fallback: string,
  label: string,
  keywords: string
]

const RAW_NOTO_ITEMS: readonly RawNotoTuple[] = [
  ['grinning', '1f600', '😀', '露齿笑', '笑 开心 哈哈 grin happy smile'],
  ['joy', '1f602', '😂', '笑哭', '笑哭 喜极而泣 哈哈 joy lol tears laugh'],
  ['rofl', '1f923', '🤣', '笑得满地打滚', '笑死 打滚 爆笑 rofl lmao laugh'],
  ['smile', '1f60a', '😊', '羞涩微笑', '微笑 暖心 开心 blush warm smile'],
  ['sweat-smile', '1f605', '😅', '苦笑流汗', '尴尬 汗 苦笑 sweat awkward grin'],
  ['upside-down', '1f643', '🙃', '倒脸无奈', '倒脸 无奈 反讽 upside down'],
  ['wink', '1f609', '😉', '眨眼俏皮', '眨眼 懂的 俏皮 wink playful'],
  ['hearts', '1f970', '🥰', '喜笑颜开', '喜欢 幸福 爱心脸 love hearts adore'],
  ['heart-eyes', '1f60d', '😍', '花痴心动', '心动 爱慕 花痴 heart eyes love'],
  ['star-struck', '1f929', '🤩', '崇拜星星眼', '星星眼 崇拜 惊艳 star struck wow'],
  ['kiss', '1f618', '😘', '飞吻比心', '飞吻 么么哒 亲亲 kiss love'],
  ['yum', '1f60b', '😋', '美味馋嘴', '好吃 美味 吐舌 yum delicious'],
  ['zany', '1f92a', '🤪', '滑稽搞怪', '搞怪 鬼脸 疯癫 zany goofy crazy'],
  ['hug', '1f917', '🤗', '温暖拥抱', '抱抱 拥抱 欢迎 hug warm'],
  ['cool', '1f60e', '😎', '墨镜酷盖', '酷 墨镜 帅气 cool sunglasses'],
  ['thinking', '1f914', '🤔', '陷入思考', '思考 琢磨 疑惑 thinking hmm'],
  ['melting', '1fae0', '🫠', '原地融化', '融化 社死 热化了 melt awkward'],
  ['salute', '1fae1', '🫡', '敬礼致意', '敬礼 收到 瑞思拜 salute respect'],
  ['holding-tears', '1f979', '🥹', '忍住眼泪', '感动 泪目 破防 tears touched'],
  ['pleading', '1f97a', '🥺', '可怜恳求', '委屈 求求 水汪汪 pleading puppy'],
  ['sob', '1f62d', '😭', '放声大哭', '大哭 泪奔 伤心 sob cry sad'],
  ['scream', '1f631', '😱', '惊恐尖叫', '吓死 震惊 尖叫 scream shock omg'],
  ['mind-blown', '1f92f', '🤯', '脑洞爆炸', '脑洞 炸裂 震撼 mind blown explode'],
  ['triumph', '1f624', '😤', '傲娇哼气', '哼 傲娇 斗志 triumph huff'],
  ['sleeping', '1f634', '😴', '呼呼大睡', '困 睡觉 晚安 sleep tired zzz'],
  ['party', '1f973', '🥳', '派对庆祝', '庆祝 生日 狂欢 party celebrate'],
  ['ghost', '1f47b', '👻', '可爱幽灵', '幽灵 阿飘 搞怪 ghost cute'],
  ['robot', '1f916', '🤖', '机器人', '机器人 科技 AI robot bot'],
  ['fire', '1f525', '🔥', '燃起来了', '火 热门 燃 爆款 fire hot lit'],
  ['sparkles', '2728', '✨', '闪耀星光', '闪亮 灵感 星光 sparkles magic shine'],
  ['tada', '1f389', '🎉', '礼花撒花', '撒花 恭喜 庆祝 tada party congrats'],
  ['heart', '2764_fe0f', '❤️', '红心热爱', '红心 爱 喜欢 heart love red'],
  ['sparkling-heart', '1f496', '💖', '闪亮爱心', '闪耀爱心 心动 少女心 sparkling heart pink'],
  ['100', '1f4af', '💯', '满分赞同', '满分 一百分 完美 hundred 100 perfect'],
  ['thumbs-up', '1f44d', '👍', '竖起大拇指', '点赞 棒 赞同 thumbs up good like'],
  ['clap', '1f44f', '👏', '热烈鼓掌', '鼓掌 啪啪 精彩 clap applause bravo'],
  ['pray', '1f64f', '🙏', '双手合十', '感谢 拜托 祈祷 pray thanks please'],
  ['wave', '1f44b', '👋', '挥手致意', '你好 再见 挥手 wave hello hi bye'],
  ['muscle', '1f4aa', '💪', '力量加油', '加油 肌肉 冲鸭 muscle strong power'],
  ['eyes', '1f440', '👀', '暗中观察', '围观 看看 盯 eyes look watch'],
  ['bulb', '1f4a1', '💡', '灵感灯泡', '点子 灵感 想法 bulb idea light'],
  ['music', '1f3b6', '🎶', '跃动音符', '音乐 歌 旋律 music notes song'],
  ['coffee', '2615', '☕', '醇香咖啡', '咖啡 下午茶 提神 coffee cafe tea'],
  ['ramen', '1f35c', '🍜', '热气拉面', '拉面 美食 夜宵 ramen noodles food'],
  ['sakura', '1f338', '🌸', '浪漫樱花', '樱花 春天 花朵 sakura cherry blossom'],
  ['rainbow', '1f308', '🌈', '绚丽彩虹', '彩虹 好运 晴朗 rainbow sky'],
  ['cat', '1f431', '🐱', '可爱猫咪', '猫咪 喵星人 小猫 cat kitty meow'],
  ['rocket', '1f680', '🚀', '火箭起飞', '起飞 发布 冲刺 rocket launch ship'],
  ['laptop', '1f4bb', '💻', '写代码', '电脑 编程 开发 laptop code dev'],
  ['camera', '1f4f8', '📸', '定格瞬间', '拍照 摄影 相机 camera photo snap']
]

type RawFluentTuple = readonly [
  slug: string,
  folder: string,
  filename: string,
  fallback: string,
  label: string,
  keywords: string
]

const RAW_FLUENT_ITEMS: readonly RawFluentTuple[] = [
  ['grinning', 'Smilies', 'Grinning Face.png', '😀', '露齿大笑', '笑 开心 哈哈 grin happy'],
  ['smile', 'Smilies', 'Smiling Face with Smiling Eyes.png', '😊', '温柔微笑', '微笑 开心 暖心 smile warm'],
  ['joy', 'Smilies', 'Face with Tears of Joy.png', '😂', '笑出眼泪', '笑哭 哈哈 爆笑 joy lol tears'],
  ['sweat-smile', 'Smilies', 'Grinning Face with Sweat.png', '😅', '尴尬苦笑', '汗 尴尬 苦笑 sweat awkward'],
  ['upside-down', 'Smilies', 'Upside-Down Face.png', '🙃', '倒脸微笑', '倒脸 无奈 调侃 upside down'],
  ['wink', 'Smilies', 'Winking Face.png', '😉', '俏皮眨眼', '眨眼 暗示 wink playful'],
  ['hearts', 'Smilies', 'Smiling Face with Hearts.png', '🥰', '满满爱意', '幸福 喜欢 爱心脸 hearts adore'],
  ['heart-eyes', 'Smilies', 'Smiling Face with Heart-Eyes.png', '😍', '双眼冒心', '花痴 心动 喜欢 heart eyes'],
  ['star-struck', 'Smilies', 'Star-Struck.png', '🤩', '闪耀崇拜', '星星眼 惊艳 崇拜 star struck wow'],
  ['cool', 'Smilies', 'Smiling Face with Sunglasses.png', '😎', '酷炫墨镜', '酷 墨镜 大佬 cool sunglasses'],
  ['party', 'Smilies', 'Partying Face.png', '🥳', '狂欢派对', '派对 庆祝 生日 party celebrate'],
  ['thinking', 'Smilies', 'Thinking Face.png', '🤔', '认真思考', '思考 疑惑 琢磨 thinking hmm'],
  ['pleading', 'Smilies', 'Pleading Face.png', '🥺', '楚楚可怜', '委屈 求求 可怜 pleading cute'],
  ['sob', 'Smilies', 'Loudly Crying Face.png', '😭', '暴风哭泣', '大哭 泪崩 难过 sob cry'],
  ['scream', 'Smilies', 'Face Screaming in Fear.png', '😱', '瞳孔地震', '尖叫 震惊 吓坏 scream shock'],
  ['mind-blown', 'Smilies', 'Exploding Head.png', '🤯', '头脑风暴', '脑洞 爆炸 炸裂 mind blown explode'],
  ['sleeping', 'Smilies', 'Sleeping Face.png', '😴', '香甜入睡', '睡觉 困 晚安 sleep zzz'],
  ['ghost', 'Smilies', 'Ghost.png', '👻', '俏皮幽灵', '幽灵 万圣节 搞怪 ghost boo'],
  ['robot', 'Smilies', 'Robot.png', '🤖', '智能机甲', '机器人 AI 科技 robot ai'],
  ['heart', 'Smilies', 'Red Heart.png', '❤️', '立体红心', '红心 爱 心意 red heart love'],
  ['sparkling-heart', 'Smilies', 'Sparkling Heart.png', '💖', '璀璨爱心', '闪亮爱心 喜欢 sparkling heart'],
  ['100', 'Smilies', 'Hundred Points.png', '💯', '一百分', '满分 赞 完美 hundred 100'],
  ['thumbs-up', 'Hand gestures', 'Thumbs Up.png', '👍', '实力点赞', '点赞 大拇指 棒 thumbs up like'],
  ['clap', 'Hand gestures', 'Clapping Hands.png', '👏', '鼓掌喝彩', '鼓掌 喝彩 精彩 clap bravo'],
  ['pray', 'Hand gestures', 'Folded Hands.png', '🙏', '诚挚感谢', '感谢 合十 祈祷 pray thanks'],
  ['muscle', 'Hand gestures', 'Flexed Biceps.png', '💪', '元气加油', '加油 力量 健身 muscle strong'],
  ['eyes', 'Hand gestures', 'Eyes.png', '👀', '前排围观', '围观 盯 看看 eyes look'],
  ['fire', 'Travel and places', 'Fire.png', '🔥', '立体烈焰', '火 燃 热门 fire hot'],
  ['rocket', 'Travel and places', 'Rocket.png', '🚀', '极速火箭', '火箭 上线 起飞 rocket launch'],
  ['star', 'Travel and places', 'Glowing Star.png', '🌟', '闪耀明星', '星星 高光 闪亮 glowing star'],
  ['rainbow', 'Travel and places', 'Rainbow.png', '🌈', '梦幻彩虹', '彩虹 晴天 幸运 rainbow'],
  ['sun', 'Travel and places', 'Sun.png', '☀️', '明媚阳光', '太阳 晴朗 早安 sun sunny'],
  ['moon', 'Travel and places', 'Crescent Moon.png', '🌙', '静谧弯月', '月亮 深夜 晚安 moon night'],
  ['sparkles', 'Activities', 'Sparkles.png', '✨', '璀璨星芒', '星光 闪耀 灵感 sparkles shine'],
  ['tada', 'Activities', 'Party Popper.png', '🎉', '缤纷礼花', '礼花 撒花 庆祝 party popper tada'],
  ['game', 'Activities', 'Video Game.png', '🎮', '游戏时光', '游戏 手柄 娱乐 game play'],
  ['headphone', 'Objects', 'Headphone.png', '🎧', '沉浸耳机', '耳机 听歌 音乐 headphone audio'],
  ['camera', 'Objects', 'Camera with Flash.png', '📸', '闪光相机', '相机 摄影 记录 camera photo'],
  ['bulb', 'Objects', 'Light Bulb.png', '💡', '创意灵光', '灯泡 灵感 创意 light bulb idea'],
  ['laptop', 'Objects', 'Laptop.png', '💻', '极客笔电', '电脑 开发 写作 laptop work'],
  ['coffee', 'Food', 'Hot Beverage.png', '☕', '热美式', '咖啡 热饮 休息 coffee tea'],
  ['cake', 'Food', 'Shortcake.png', '🍰', '草莓蛋糕', '蛋糕 甜点 下午茶 cake sweet'],
  ['ramen', 'Food', 'Steaming Bowl.png', '🍜', '浓郁拉面', '拉面 美食 汤面 ramen bowl'],
  ['cat', 'Animals', 'Cat Face.png', '🐱', '软萌小猫', '猫 喵 宠物 cat cute'],
  ['dog', 'Animals', 'Dog Face.png', '🐶', '乖巧小狗', '狗 汪 宠物 dog puppy'],
  ['bear', 'Animals', 'Bear.png', '🐻', '憨厚小熊', '小熊 玩偶 bear'],
  ['fox', 'Animals', 'Fox.png', '🦊', '机敏狐狸', '狐狸 灵动 fox'],
  ['butterfly', 'Animals', 'Butterfly.png', '🦋', '翩翩彩蝶', '蝴蝶 自然 butterfly'],
  ['check', 'Symbols', 'Check Mark Button.png', '✅', '圆满达成', '完成 打卡 勾号 check done']
]

export const NOTO_ANIMATED_EMOJIS: readonly AnimatedEmojiItem[] = RAW_NOTO_ITEMS.map(
  ([slug, codepoint, fallback, label, keywords]) => ({
    code: `:noto-${slug}:`,
    pack: 'noto',
    label,
    keywords: `${label} ${keywords} noto ${slug}`,
    fallback,
    url: buildNotoUrl(codepoint)
  })
)

export const FLUENT_ANIMATED_EMOJIS: readonly AnimatedEmojiItem[] = RAW_FLUENT_ITEMS.map(
  ([slug, folder, filename, fallback, label, keywords]) => ({
    code: `:fluent-${slug}:`,
    pack: 'fluent',
    label,
    keywords: `${label} ${keywords} fluent 3d ${slug}`,
    fallback,
    url: buildFluentUrl(folder, filename)
  })
)

type RawStandardTuple = readonly [emoji: string, label: string, keywords: string]

function buildStandardGroup(
  id: string,
  label: string,
  icon: string,
  tuples: readonly RawStandardTuple[]
): StandardEmojiGroup {
  return {
    id,
    label,
    icon,
    items: tuples.map(([emoji, itemLabel, keywords]) => ({
      emoji,
      label: itemLabel,
      keywords: `${itemLabel} ${keywords}`
    }))
  }
}

export const STANDARD_EMOJI_GROUPS: readonly StandardEmojiGroup[] = [
  buildStandardGroup('smileys', '表情与情感', '😊', [
    ['😀', '大笑', '笑 开心 grin happy'],
    ['😃', '哈哈', '开心 灿烂 smiley'],
    ['😄', '笑眼弯弯', '高兴 欢笑 smile'],
    ['😁', '嘻嘻', '露齿 得意 beaming'],
    ['😆', '眯眼爆笑', '狂笑 哈哈 laughing'],
    ['😅', '流汗笑', '尴尬 汗 sweat'],
    ['🤣', '笑翻了', '打滚 笑死 rofl'],
    ['😂', '笑哭了', '喜极而泣 joy lol'],
    ['🙂', '浅浅微笑', '微笑 礼貌 slight smile'],
    ['🙃', '倒脸', '无奈 反话 upside down'],
    ['🫠', '融化', '社死 热 melt'],
    ['😉', '眨眼', '俏皮 懂的 wink'],
    ['😊', '害羞笑', '温暖 微笑 blush'],
    ['😇', '天使笑', '乖巧 纯洁 halo angel'],
    ['🥰', '爱心围绕', '幸福 恋爱 love hearts'],
    ['😍', '花痴', '心动 迷恋 heart eyes'],
    ['🤩', '星星眼', '崇拜 惊艳 star struck'],
    ['😘', '飞吻', '亲亲 么么哒 kiss'],
    ['😋', '好吃', '美味 吐舌 yum'],
    ['😜', '吐舌眨眼', '调皮 鬼脸 stuck out tongue'],
    ['🤪', '滑稽脸', '搞怪 疯 zany'],
    ['🤗', '抱抱', '拥抱 温暖 hug'],
    ['🤭', '捂嘴笑', '偷笑 害羞 giggle'],
    ['🤫', '嘘', '安静 保密 shush quiet'],
    ['🤔', '思考', '想一想 疑惑 think'],
    ['🫡', '敬礼', '收到 致敬 salute'],
    ['😌', '舒心', '平静 放松 relieved'],
    ['😎', '酷', '墨镜 帅 cool'],
    ['🤓', '书呆子', '眼镜 极客 nerd geek'],
    ['🧐', '端详', '单片眼镜 审视 monocle'],
    ['🥳', '派对脸', '庆祝 生日 party'],
    ['🥹', '忍泪', '感动 泪目 holding tears'],
    ['🥺', '求求了', '委屈 可怜 pleading'],
    ['😢', '流泪', '难过 伤心 cry tear'],
    ['😭', '大哭', '泪奔 痛哭 sob'],
    ['😤', '哼气', '傲娇 努力 triumph'],
    ['🤯', '脑洞炸裂', '震撼 爆炸头 mind blown'],
    ['😱', '惊叫', '害怕 震惊 scream'],
    ['😴', '熟睡', '困 晚安 sleep'],
    ['👻', '小幽灵', '阿飘 可爱 ghost'],
    ['❤️', '红心', '爱 喜欢 heart love'],
    ['🧡', '橙心', '温暖 活力 orange heart'],
    ['💛', '黄心', '友谊 阳光 yellow heart'],
    ['💚', '绿心', '自然 清新 green heart'],
    ['💙', '蓝心', '治愈 信任 blue heart'],
    ['💜', '紫心', '浪漫 神秘 purple heart'],
    ['🤍', '白心', '纯粹 干净 white heart'],
    ['💖', '闪亮心', '心动 闪耀 sparkling heart'],
    ['💔', '心碎', '难过 伤心 broken heart'],
    ['💯', '一百分', '满分 完美 100 hundred']
  ]),
  buildStandardGroup('gestures', '手势与人物', '👋', [
    ['👋', '挥手', '你好 再见 wave hello bye'],
    ['🤚', '举手', '停 打招呼 raised back hand'],
    ['✋', '击掌', '手掌 停 high five palm'],
    ['👌', 'OK', '没问题 好的 ok hand'],
    ['🤌', '拿捏', '意大利手势 讲究 pinched'],
    ['🤏', '一点点', '拿捏 微小 pinching little'],
    ['✌️', '耶', '胜利 剪刀手 victory peace'],
    ['🤞', '祝好运', '祈愿 交叉手指 crossed fingers luck'],
    ['🫰', '比心', '手指比心 爱 finger heart'],
    ['🤟', '爱你手势', '摇滚 爱你 love you'],
    ['🤘', '摇滚', '金属 酷 rock horns'],
    ['🤙', '电话联系', '六六六 冲浪 call me shaka'],
    ['👈', '向左指', '左边 看左 point left'],
    ['👉', '向右指', '右边 重点 point right'],
    ['👆', '向上指', '上面 置顶 point up'],
    ['👇', '向下指', '下面 链接 point down'],
    ['👍', '点赞', '大拇指 棒 thumbs up good'],
    ['👎', '踩', '不赞同 差评 thumbs down'],
    ['✊', '握拳', '加油 坚持 fist power'],
    ['👊', '碰拳', '兄弟 击拳 bump fist'],
    ['👏', '鼓掌', '喝彩 啪啪 clap applause'],
    ['🙌', '举双手', '欢呼 万岁 raised hands hooray'],
    ['🫶', '双手比心', '爱心 感谢 heart hands'],
    ['👐', '张开手', '欢迎 拥抱 open hands'],
    ['🤝', '握手', '合作 成交 handshake deal'],
    ['🙏', '合十', '感谢 祈祷 拜托 pray thanks'],
    ['✍️', '书写', '写作 记录 writing note'],
    ['💪', '肌肉', '力量 加油 健身 muscle strong'],
    ['👀', '眼睛', '围观 盯 注目 eyes look'],
    ['🧠', '大脑', '智慧 思考 脑力 brain smart'],
    ['🧑‍💻', '程序员', '写代码 开发 极客 coder developer'],
    ['🎨', '艺术创作', '画画 设计 调色盘 art palette'],
    ['🏃', '奔跑', '运动 跑步 冲刺 run runner'],
    ['🧘', '冥想', '瑜伽 专注 平静 lotus yoga'],
    ['💃', '跳舞', '欢快 舞动 dance']
  ]),
  buildStandardGroup('nature', '动物与自然', '🐱', [
    ['🐱', '小猫', '猫咪 喵 cat kitty'],
    ['🐶', '小狗', '狗狗 汪 dog puppy'],
    ['🐰', '小兔', '兔子 软萌 rabbit bunny'],
    ['🦊', '狐狸', '机灵 小狐狸 fox'],
    ['🐻', '小熊', '棕熊 可爱 bear'],
    ['🐼', '熊猫', '国宝 团子 panda'],
    ['🐻‍❄️', '北极熊', '白熊 冰雪 polar bear'],
    ['🐨', '考拉', '树袋熊 呆萌 koala'],
    ['🐯', '老虎', '大猫 威武 tiger'],
    ['🦁', '狮子', '王者 霸气 lion'],
    ['🐮', '小牛', '奶牛 牛气 cow'],
    ['🐷', '小猪', '猪猪 可爱 pig'],
    ['🐸', '青蛙', '蛙蛙 呱 frog'],
    ['🐵', '小猴', '猴子 调皮 monkey'],
    ['🐧', '企鹅', '南极 摇摆 penguin'],
    ['🐦', '小鸟', '飞鸟 自由 bird'],
    ['🦉', '猫头鹰', '熬夜 夜猫子 owl night'],
    ['🦄', '独角兽', '梦幻 奇幻 unicorn'],
    ['🐝', '蜜蜂', '勤劳 采蜜 bee'],
    ['🦋', '蝴蝶', '蜕变 飞舞 butterfly'],
    ['🐢', '乌龟', '慢生活 长寿 turtle'],
    ['🐙', '章鱼', '八爪鱼 可爱 octopus'],
    ['🐬', '海豚', '海洋 灵动 dolphin'],
    ['🐳', '鲸鱼', '深海 蓝鲸 whale'],
    ['🌸', '樱花', '春天 浪漫 sakura blossom'],
    ['🌷', '郁金香', '花朵 优雅 tulip flower'],
    ['🌹', '玫瑰', '爱情 浪漫 rose'],
    ['🌻', '向日葵', '阳光 积极 sunflower'],
    ['🌼', '雏菊', '小花 清新 blossom daisy'],
    ['🌿', '枝叶', '植物 自然 绿植 herb leaf'],
    ['🍀', '四叶草', '幸运 好运 four leaf clover luck'],
    ['🍁', '枫叶', '秋天 红叶 maple autumn'],
    ['🍂', '落叶', '深秋 诗意 fallen leaf'],
    ['🌲', '松树', '森林 常青 tree forest'],
    ['🌵', '仙人掌', '沙漠 坚韧 cactus']
  ]),
  buildStandardGroup('food', '美食与饮品', '☕', [
    ['☕', '热咖啡', '咖啡 拿铁 美式 coffee cafe'],
    ['🍵', '热茶', '绿茶 抹茶 品茗 tea matcha'],
    ['🧋', '珍珠奶茶', '奶茶 快乐水 波霸 bubble tea boba'],
    ['🥤', '冰饮', '汽水 可乐 冷饮 soda cup'],
    ['🍺', '啤酒', '干杯 精酿 beer'],
    ['🍻', '碰杯', '干杯 聚会 cheers beers'],
    ['🍷', '红酒', '微醺 晚酌 wine'],
    ['🍸', '鸡尾酒', '特调 酒吧 cocktail'],
    ['🥐', '牛角包', '可颂 早餐 烘焙 croissant bread'],
    ['🍞', '吐司', '面包 早餐 bread toast'],
    ['🥞', '松饼', '薄饼 早午餐 pancakes brunch'],
    ['🍔', '汉堡', '快餐 芝士堡 burger'],
    ['🍟', '薯条', '炸薯条 零食 fries'],
    ['🍕', '披萨', '芝士 聚餐 pizza'],
    ['🌮', '塔可', '墨西哥卷 taco'],
    ['🥗', '轻食沙拉', '健康 蔬菜 减脂 salad healthy'],
    ['🍜', '热汤面', '拉面 牛肉面 夜宵 ramen noodles'],
    ['🍝', '意面', '意大利面 西餐 pasta'],
    ['🍣', '寿司', '日料 三文鱼 sushi'],
    ['🍱', '便当', '午餐 盒饭 bento lunch'],
    ['🍲', '火锅', '炖菜 暖胃 hotpot stew'],
    ['🥟', '饺子', '水饺 团圆 dumpling'],
    ['🍙', '饭团', '日式 简餐 onigiri rice'],
    ['🍰', '切块蛋糕', '甜品 下午茶 shortcake'],
    ['🎂', '生日蛋糕', '生日 许愿 birthday cake'],
    ['🧁', '纸杯蛋糕', '甜点 精致 cupcake'],
    ['🍩', '甜甜圈', '糖霜 甜食 donut'],
    ['🍪', '曲奇饼干', '下午茶 小饼干 cookie'],
    ['🍫', '巧克力', '丝滑 甜蜜 chocolate'],
    ['🍦', '冰淇淋', '甜筒 夏天 ice cream'],
    ['🍓', '草莓', '水果 鲜甜 strawberry'],
    ['🍑', '水蜜桃', '桃子 夏日 peach'],
    ['🍒', '樱桃', '车厘子 红润 cherries'],
    ['🍉', '西瓜', '盛夏 冰镇 watermelon'],
    ['🍋', '柠檬', '清爽 维C lemon']
  ]),
  buildStandardGroup('activities', '活动与休闲', '🎉', [
    ['🎉', '礼花筒', '庆祝 撒花 恭喜 tada party'],
    ['🎊', '彩球', '庆典 喜悦 confetti'],
    ['🎈', '气球', '节日 童趣 balloon'],
    ['🎁', '礼物', '惊喜 礼盒 gift present'],
    ['🎀', '蝴蝶结', '丝带 装饰 ribbon cute'],
    ['🏆', '奖杯', '冠军 荣誉 里程碑 trophy winner'],
    ['🥇', '金牌', '第一名 优秀 gold medal'],
    ['🎯', '正中靶心', '目标 精准 达成 target bullseye'],
    ['🎮', '游戏手柄', '打游戏 主机 电玩 game console'],
    ['🕹️', '街机摇杆', '复古 游戏 joystick retro'],
    ['🎲', '骰子', '桌游 随机 运气 dice random'],
    ['🧩', '拼图', '解谜 模块 契合 puzzle piece'],
    ['🎧', '头戴耳机', '听歌 播客 降噪 headphone music'],
    ['🎵', '单音符', '音乐 歌 节奏 note music'],
    ['🎶', '双音符', '旋律 哼歌 notes melody'],
    ['🎹', '钢琴键盘', '弹琴 编曲 piano keyboard'],
    ['🎸', '吉他', '民谣 摇滚 弹唱 guitar rock'],
    ['🎬', '场记板', '电影 剪辑 开拍 movie clapper'],
    ['🎞️', '胶片', '影像 复古 电影感 film cinema'],
    ['📚', '书本叠放', '阅读 学习 知识 books read'],
    ['📖', '摊开的书', '读书 笔记 故事 open book'],
    ['🎭', '戏剧面具', '演出 戏剧 人生 theater drama'],
    ['🎪', '马戏帐篷', '嘉年华 游乐 circus'],
    ['⚽', '足球', '运动 比赛 soccer football'],
    ['🏀', '篮球', '球场 投篮 basketball'],
    ['🎾', '网球', '挥拍 运动 tennis'],
    ['🏸', '羽毛球', '球馆 挥拍 badminton'],
    ['🏊', '游泳', '泳池 清凉 swim'],
    ['🚴', '骑行', '单车 兜风 cycling bike'],
    ['🧗', '攀岩', '挑战 向上 climb']
  ]),
  buildStandardGroup('travel', '旅行与风景', '🚀', [
    ['🚀', '火箭', '起飞 发布 探索 rocket launch'],
    ['✈️', '飞机', '旅行 出发 远方 airplane flight'],
    ['🚄', '高铁', '列车 出行 旅途 train highspeed'],
    ['🚗', '自驾小车', '兜风 公路旅行 car drive'],
    ['🚲', '自行车', '漫游 骑行 bicycle'],
    ['⛵', '帆船', '扬帆 出海 sailboat sea'],
    ['🗺️', '世界地图', '探索 足迹 环游 map world'],
    ['🧭', '指南针', '方向 寻路 探索 compass guide'],
    ['🏔️', '雪山', '远山 登顶 壮阔 snow mountain'],
    ['⛰️', '山峦', '徒步 自然 mountain hike'],
    ['🏖️', '海滩阳伞', '度假 海边 沙滩 beach vacation'],
    ['🏝️', '无人小岛', '海岛 放空 island'],
    ['🏕️', '露营帐篷', '野营 星空 户外 camping tent'],
    ['🌆', '城市黄昏', '日落 街景 暮色 cityscape dusk'],
    ['🌃', '璀璨夜景', '星空 城市 夜晚 night stars'],
    ['🌉', '夜幕大桥', '桥梁 晚风 bridge night'],
    ['🏠', '温馨小屋', '家 宅家 生活 home house'],
    ['🎡', '摩天轮', '游乐园 浪漫 ferris wheel'],
    ['🎢', '过山车', '刺激 游乐场 roller coaster'],
    ['🗼', '铁塔', '地标 打卡 tower'],
    ['☀️', '太阳', '晴天 温暖 早安 sun sunny'],
    ['🌤️', '晴间多云', '好天气 微风 sun cloud'],
    ['⛅', '云朵遮日', '多云 柔和 cloudy'],
    ['🌧️', '下雨', '雨天 听雨 rain'],
    ['❄️', '雪花', '下雪 冬天 纯白 snow winter'],
    ['🌈', '彩虹', '雨后 好运 rainbow'],
    ['🌙', '弯月', '月色 晚安 深夜 crescent moon'],
    ['🌕', '满月', '团圆 月光 full moon'],
    ['⭐', '五角星', '星星 收藏 好评 star'],
    ['🌟', '闪亮星', '高光 璀璨 glowing star'],
    ['✨', '星光闪烁', '美好 干净 灵感 sparkles'],
    ['🔥', '火焰', '热情 热门 燃 fire hot'],
    ['💧', '水滴', '清澈 纯净 droplet water'],
    ['🌊', '海浪', '大海 浪花 冲浪 wave ocean'],
    ['⚡', '闪电', '极速 能量 酷炫 zap lightning']
  ]),
  buildStandardGroup('objects', '物品与符号', '💡', [
    ['💡', '灯泡', '灵感 创意 点子 bulb idea'],
    ['💻', '笔记本电脑', '工作 代码 写作 laptop mac'],
    ['🖥️', '台式显示器', '桌面 工作站 desktop monitor'],
    ['⌨️', '机械键盘', '打字 码字 编码 keyboard type'],
    ['📱', '智能手机', '移动 应用 随手拍 phone mobile'],
    ['⌚', '手表', '时间 效率 准时 watch time'],
    ['📷', '相机', '摄影 扫街 记录 camera'],
    ['📸', '闪光拍照', '快门 瞬间 定格 snap photo'],
    ['📹', '摄像机', '视频 Vlog 拍摄 video'],
    ['🎙️', '麦克风', '播客 录音 分享 mic podcast'],
    ['🔋', '满格电池', '充电 能量 恢复 battery energy'],
    ['🔍', '放大镜', '搜索 发现 细节 search zoom'],
    ['🕯️', '蜡烛', '氛围 温暖 静心 candle cozy'],
    ['📝', '备忘笔记', '记录 清单 写作 memo write'],
    ['✏️', '铅笔', '草稿 修改 手写 pencil edit'],
    ['📌', '图钉', '置顶 重点 标记 pin'],
    ['📎', '回形针', '附件 整理 paperclip'],
    ['🗂️', '分类夹', '归档 索引 整理 archive folder'],
    ['📅', '日历', '计划 日程 纪念日 calendar date'],
    ['⏰', '闹钟', '提醒 早起 倒计时 alarm clock'],
    ['🔑', '钥匙', '解锁 关键 秘诀 key unlock'],
    ['🔒', '上锁', '私密 安全 保护 lock private'],
    ['💎', '宝石', '珍贵 品质 闪耀 gem diamond'],
    ['🪄', '魔法棒', '奇妙 优化 蜕变 magic wand'],
    ['🫧', '泡泡', '轻盈 梦幻 治愈 bubbles'],
    ['✅', '绿色勾号', '完成 通过 打卡 check ok'],
    ['☑️', '勾选框', '待办 已完成 checkbox'],
    ['❗', '感叹号', '重要 注意 强调 exclamation'],
    ['❓', '问号', '疑问 好奇 question'],
    ['💬', '对话气泡', '评论 聊天 想法 speech comment'],
    ['💭', '思考气泡', '脑海 遐想 thought'],
    ['🔔', '铃铛', '通知 提醒 动态 bell notify'],
    ['🏷️', '标签', '分类 话题 tag label'],
    ['🔗', '链接', '分享 网址 串联 link url'],
    ['♾️', '无限符号', '永恒 无限 可能 infinity']
  ])
]

export const ANIMATED_EMOJI_MAP: ReadonlyMap<string, AnimatedEmojiItem> = new Map<
  string,
  AnimatedEmojiItem
>(
  [...NOTO_ANIMATED_EMOJIS, ...FLUENT_ANIMATED_EMOJIS].map((item) => [item.code, item])
)

export const ANIMATED_EMOJI_REGEX = /:(?:noto|fluent)-[a-z0-9_-]+:/g

export function resolveAnimatedEmoji(code: string): AnimatedEmojiItem | null {
  if (!code) return null
  const direct = ANIMATED_EMOJI_MAP.get(code)
  if (direct) return direct
  if (!code.startsWith(':') && !code.endsWith(':')) {
    return ANIMATED_EMOJI_MAP.get(`:${code}:`) ?? null
  }
  return null
}

function isValidEmojiToken(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 48) return false
  if (trimmed.startsWith(':')) {
    return resolveAnimatedEmoji(trimmed) !== null
  }
  return true
}

export function readRecentEmojis(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_EMOJIS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const result: string[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue
      const trimmed = entry.trim()
      if (!isValidEmojiToken(trimmed) || seen.has(trimmed)) continue
      seen.add(trimmed)
      result.push(trimmed)
      if (result.length >= MAX_RECENT_EMOJIS) break
    }
    return result
  } catch {
    return []
  }
}

export function pushRecentEmoji(value: string): string[] {
  const trimmed = (value || '').trim()
  const existing = readRecentEmojis()
  if (!isValidEmojiToken(trimmed)) {
    return existing
  }
  const next = [trimmed, ...existing.filter((item) => item !== trimmed)].slice(0, MAX_RECENT_EMOJIS)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENT_EMOJIS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Ignore storage quota or privacy-mode write errors.
    }
  }
  return next
}
