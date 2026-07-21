// Hatch i18n
//
// The app renders English markup from template literals in components.js /
// pages.js. Rather than threading a t() call through ~17k lines of those
// templates, translation happens as a post-render DOM pass: render() writes
// English HTML, then apply() walks the tree swapping exact-match text nodes
// and translatable attributes. Anything not in the dictionary (user content —
// Hatch titles, names, messages) passes through untouched, which is what we
// want. Every pass starts from freshly-rendered English, so translation is
// never applied twice to the same node.
window.HatchI18n = (() => {
  const STORAGE_KEY = "hatchLang";
  const DEFAULT_LANG = "en";

  const LANGUAGES = [
    { code: "en", label: "English", native: "English" },
    { code: "zh", label: "Chinese", native: "中文" },
  ];

  // English → Simplified Chinese. Keys must match the rendered text exactly
  // (after whitespace collapsing). "Hatch" stays as the brand name.
  const ZH = {
    // ── Navigation, footer, account ──────────────────────────────────────────
    "Hatches": "Hatch 任务",
    "Browse Hatches": "浏览 Hatch",
    "Verified Results": "已验证成果",
    "Become a Hatcher": "成为 Hatcher",
    "Leveling up as a Hatcher": "Hatcher 晋级之路",
    "Trust": "信任",
    "Log in": "登录",
    "Log out": "退出登录",
    "Sign in": "登录",
    "Sign out": "退出登录",
    "Sign up / Log in": "注册 / 登录",
    "Get Hatch free": "免费开始使用 Hatch",
    "Post a Hatch": "发布 Hatch",
    "My Hatches": "我的 Hatch",
    "Your Hatches": "你的 Hatch",
    "New Hatch": "新建 Hatch",
    "View your profile": "查看个人主页",
    "Profile": "个人主页",
    "Messages": "消息",
    "Overview": "概览",
    "AI-powered Hatches for real business work.": "用 AI 驱动的 Hatch 完成真实的商业工作。",
    "Open account menu": "打开账户菜单",
    "Primary navigation": "主导航",
    "Hatch home": "Hatch 首页",
    "Hatch logo": "Hatch 标志",
    "Switch to dark mode": "切换到深色模式",
    "Switch to light mode": "切换到浅色模式",

    // ── Common actions ───────────────────────────────────────────────────────
    "Save": "保存",
    "Save draft": "保存草稿",
    "Save change": "保存修改",
    "Save Hatch": "保存 Hatch",
    "Cancel": "取消",
    "Close": "关闭",
    "Confirm": "确认",
    "Continue": "继续",
    "Back": "返回",
    "Edit": "编辑",
    "Delete": "删除",
    "Remove": "移除",
    "Add": "添加",
    "Send": "发送",
    "Open": "打开",
    "Select": "选择",
    "Share": "分享",
    "Download": "下载",
    "Preview": "预览",
    "Resume": "继续",
    "Pause": "暂停",
    "Stop": "停止",
    "Search": "搜索",
    "Approve": "通过",
    "Reject": "拒绝",
    "View all": "查看全部",
    "View details": "查看详情",
    "View Project": "查看项目",
    "Skip for now": "暂时跳过",

    // ── Home / hero ──────────────────────────────────────────────────────────
    "What do you need help with?": "你需要什么帮助？",
    "I need help with": "我需要帮助的是",
    "Tell us everything.": "把情况都告诉我们。",
    "Don’t worry about making it perfect.": "不必追求完美。",
    "Just explain your situation naturally, as if you were talking to a colleague.": "像和同事聊天一样，自然地说明你的情况就好。",
    "Project description": "项目描述",
    "Describe the Hatch first, even with one short sentence.": "先描述你的 Hatch，哪怕只有一句话。",
    "Start typing, use voice input, or attach files to shape your Hatch.": "开始输入、使用语音，或上传文件来构建你的 Hatch。",
    "Voice input": "语音输入",
    "Delete voice text": "删除语音文字",
    "Attach files": "上传文件",
    "Attach a file": "上传文件",
    "Add a file": "添加文件",
    "Your microphone is only used while recording.": "麦克风仅在录音时使用。",
    "Helpful things to mention:": "可以补充这些信息：",
    "What you’re trying to achieve": "你想达成的目标",
    "Your business or project": "你的业务或项目",
    "What you already have": "你已经有的材料",
    "What success looks like": "怎样算成功",
    "Deadlines": "截止时间",
    "References": "参考资料",
    "Focus the project description box": "定位到项目描述框",
    "Task input options": "任务输入选项",
    "Why Hatch": "为什么选择 Hatch",
    "Not another gig marketplace.": "不是又一个零工平台。",
    "Traditional marketplaces": "传统平台",
    "For students & freelancers": "面向学生与自由职业者",
    "For small businesses": "面向小型企业",
    "Hatch lifecycle": "Hatch 生命周期",
    "Every Great Solution Starts as a Hatch": "每一个出色的方案，都始于一个 Hatch",
    "Hatched Work": "已孵化的工作",
    "Recently Hatched": "最近孵化",
    "Recently completed": "最近完成",
    "Recent verified results": "最新已验证成果",
    "Recommended Hatchers": "推荐 Hatcher",
    "Mock matches": "模拟匹配",
    "Verified delivery": "已验证交付",
    "Outputs": "产出",
    "Time saved": "节省时间",
    "Fiverr and similar platforms make you do the hard part: writing the brief, vetting strangers, and waiting. Hatch puts AI in the middle of every project, so both sides win.": "Fiverr 之类的平台把最难的部分丢给你：写需求、筛选陌生人、然后等待。Hatch 把 AI 放在每个项目的中心，让双方都受益。",
    "Describing the work": "描述工作",
    "Write the perfect brief yourself, or get ignored": "要么自己写出完美需求，要么无人问津",
    "✓ Just talk naturally — AI turns it into a complete brief": "✓ 只需自然表达 —— AI 会整理成完整需求",
    "Finding the right person": "找到合适的人",
    "Scroll hundreds of near-identical gigs and reviews": "在成百上千条雷同的服务和评价中翻找",
    "✓ Matched to a verified Hatcher who fits the project": "✓ 匹配到与项目契合的已验证 Hatcher",
    "Speed": "速度",
    "Days of back-and-forth before work even starts": "还没开工就已来回沟通数天",
    "✓ AI-assisted scoping means work starts in hours, not days": "✓ AI 辅助定义范围，几小时内即可开工",
    "Pricing": "定价",
    "Race-to-the-bottom bidding on hourly rates": "时薪竞价，一路压到底",
    "✓ Fair prices tied to outcomes and verified results": "✓ 价格与成果和已验证结果挂钩，公平合理",
    "Your AI skills are worth more than $5 gigs. With AI handling the busywork, you deliver more projects, faster — and build verified results that let you level up and charge what the outcome is worth.": "你的 AI 技能远不止值 5 美元一单。让 AI 处理琐碎工作，你可以更快交付更多项目，积累已验证成果，从而晋级并按成果价值收费。",
    "No more guessing what to write in a job post. Describe your problem in plain words, and AI shapes it into a brief a verified Hatcher can act on immediately — real help, faster than any gig site.": "不用再纠结招聘帖怎么写。用大白话说明你的问题，AI 会整理成已验证 Hatcher 可以立即执行的需求说明 —— 比任何零工平台都快的真实帮助。",
    "Stage 1": "第 1 阶段",
    "Stage 2": "第 2 阶段",
    "Stage 3": "第 3 阶段",
    "Incubating": "孵化中",
    "Hatched": "已孵化",
    "🐣 Hatched": "🐣 已孵化",
    "Business owners post a real business problem they would like AI to solve.": "企业主发布一个希望用 AI 解决的真实商业问题。",
    "A verified Hatcher develops and refines the solution.": "已验证的 Hatcher 开发并打磨解决方案。",
    "The completed solution is delivered and ready for the business to use.": "完成的方案交付到位，企业可直接使用。",

    // ── Hatch intake / AI assistant ──────────────────────────────────────────
    "Describe it naturally.": "用你自己的话描述。",
    "Hatch will organize the brief while you talk through the work.": "你只管讲，Hatch 会同步整理成需求说明。",
    "Live understanding": "实时理解",
    "Hatch understands": "Hatch 已理解",
    "Here’s what Hatch understands so far.": "以下是 Hatch 目前的理解。",
    "Here’s what I understand so far.": "以下是我目前的理解。",
    "Reply naturally, or choose one below.": "自然作答，或从下方选择。",
    "Type freely — Hatch will organize it.": "随意输入 —— Hatch 会帮你整理。",
    "Type a message before sending.": "发送前请先输入内容。",
    "Hatch is organizing this section...": "Hatch 正在整理这一部分…",
    "Hatch is building the brief quietly as you answer.": "你作答的同时，Hatch 正在后台生成需求说明。",
    "I’m reading through your project...": "正在通读你的项目…",
    "I’ll handle the structure and bring back a first version.": "我会梳理结构，并给出第一版。",
    "Reading": "正在读取",
    "Now working on": "正在处理",
    "Active section": "当前部分",
    "Active question": "当前问题",
    "Choose a section to edit": "选择要编辑的部分",
    "A Hatcher might still ask…": "Hatcher 可能还会问…",
    "You can answer these now or post anyway.": "你可以现在回答，也可以直接发布。",
    "Answer these now": "现在回答",
    "Post anyway": "仍然发布",
    "Ask Hatch to rewrite": "让 Hatch 重写",
    "No worries — tell me what you’d change.": "没关系 —— 告诉我你想改什么。",
    "Suggested replies": "建议回复",
    "Compact view only. Hatch still handles the writing.": "仅为紧凑视图，撰写仍由 Hatch 完成。",
    "The brief is ready for a final look.": "需求说明已可做最后确认。",
    "Ready to post.": "可以发布了。",
    "Ready to Post": "可以发布",
    "Ready": "就绪",
    "In progress": "进行中",
    "Your project brief has enough detail for Hatchers to understand the work.": "你的需求说明已足够详细，Hatcher 可以理解这项工作。",
    "AI intake connected": "AI 接入已连接",
    "Still shaping the idea": "仍在梳理想法",
    "Local intake fallback": "本地接入回退",
    "Checking AI connection...": "正在检查 AI 连接…",
    "Local fallback is being used. DeepSeek did not generate this response.": "当前使用本地回退，此回复并非由 DeepSeek 生成。",

    // ── Review / submit ──────────────────────────────────────────────────────
    "Review and Post": "确认并发布",
    "Final review": "最终确认",
    "Review your Hatch.": "确认你的 Hatch。",
    "Your Hatch is ready.": "你的 Hatch 已就绪。",
    "Review it once, then submit when it looks good.": "确认一遍，没问题就提交。",
    "This is exactly what Hatchers will see. Check it once, then post it so they can take the work.": "这就是 Hatcher 将看到的内容。确认一遍后发布，他们即可接单。",
    "Nothing to review yet.": "暂时没有可确认的内容。",
    "Describe your Hatch first — once it’s shaped, you can review and post it here.": "请先描述你的 Hatch —— 成形后即可在此确认并发布。",
    "Start a Hatch": "创建 Hatch",
    "Start a Hatch.": "创建一个 Hatch。",
    "Submit Hatch": "提交 Hatch",
    "Edit brief": "编辑需求说明",
    "Back to chat": "返回对话",
    "Attached files": "已上传文件",
    "Attach source files": "上传源文件",
    "Attach other files": "上传其他文件",
    "Use these files and continue": "使用这些文件并继续",
    "No files attached": "未上传文件",
    "No files attached yet": "尚未上传文件",
    "No files attached yet.": "尚未上传文件。",
    "No file chosen": "未选择文件",
    "Session preview unavailable": "本次会话无法预览",
    "Preview unavailable": "无法预览",
    "Preview unavailable after reload": "刷新后无法预览",
    "Preview after reload needs real storage": "刷新后预览需要真实存储支持",
    "Material types": "材料类型",
    "Attachments": "附件",
    "Link": "链接",
    "Links": "链接",
    "Files": "文件",
    "Files and references": "文件与参考资料",
    "No files or references attached.": "未上传文件或参考资料。",
    "No attachments were included.": "未包含任何附件。",
    "Reference note": "参考说明",
    "Submit your work": "提交你的成果",
    "Submit work": "提交成果",
    "Submit for review": "提交审核",
    "Update submission": "更新提交",
    "Review work": "审核成果",
    "Review submitted work": "审核已提交的成果",
    "What did you deliver?": "你交付了什么？",
    "Your feedback": "你的反馈",
    "Feedback": "反馈",
    "Request changes": "要求修改",
    "Approve & complete": "通过并完成",
    "No work has been submitted for this Hatch yet.": "这个 Hatch 还没有提交成果。",
    "This Hatch has been approved and is complete.": "这个 Hatch 已通过审核并完成。",
    "This Hatch has already been completed.": "这个 Hatch 已经完成。",
    "📮 Submitted — the client is reviewing your work.": "📮 已提交 —— 客户正在审核你的成果。",
    "📮 A submission is waiting for your review.": "📮 有一份提交等待你的审核。",
    "(optional)": "（选填）",
    "(optional — one per line)": "（选填 —— 每行一个）",
    "(optional — up to 3 MB each)": "（选填 —— 每个文件不超过 3 MB）",
    "(optional — sent to the Hatcher)": "（选填 —— 会发送给 Hatcher）",
    "What looks good, or what needs changing?": "哪些做得好，哪些需要调整？",
    "Summarize the work, what's included, and anything the client should know.": "概述你的工作、交付内容，以及客户需要知道的信息。",

    // ── Brief fields ─────────────────────────────────────────────────────────
    "Objective": "目标",
    "Client objective": "客户目标",
    "Deliverables": "交付物",
    "Expected outputs": "预期产出",
    "Outcome": "成果",
    "Scope of work": "工作范围",
    "Client context": "客户背景",
    "Missing information": "缺失信息",
    "Missing info before": "补充前缺失信息",
    "Missing info after": "补充后缺失信息",
    "Recommended Hatcher level": "推荐 Hatcher 等级",
    "Estimated completion": "预计完成时间",
    "Average completion": "平均完成时间",
    "Category": "类别",
    "Business": "业务",
    "Industry": "行业",
    "Industries": "行业",
    "Common industries": "常见行业",
    "Tools": "工具",
    "Offers": "报价",
    "Level": "等级",
    "Label": "标签",
    "Completed": "已完成",
    "Completed by": "完成者",
    "Rating": "评分",
    "rating": "评分",
    "on-time": "准时率",
    "hatched": "已孵化",
    "posted": "已发布",
    "incubating": "孵化中",
    "in review": "审核中",
    "saved": "已保存",
    "Joined": "加入时间",
    "Total earned": "累计收入",
    "Verified skills": "已验证技能",
    "View Hatcher Profile": "查看 Hatcher 主页",

    // ── Browse ───────────────────────────────────────────────────────────────
    "Find open, incubating, and recently hatched work.": "查找开放中、孵化中和最近孵化的工作。",
    "Find Hatches": "查找 Hatch",
    "Hatch filters": "Hatch 筛选",
    "Clear filters": "清除筛选",
    "Sort by": "排序方式",
    "Featured": "精选",
    "Price": "价格",
    "Length": "周期",
    "Minimum": "最小值",
    "Maximum": "最大值",
    "All industries": "全部行业",
    "Time: shortest first": "周期：由短到长",
    "Price: low to high": "价格：由低到高",
    "Level: L1 → L3": "等级：L1 → L3",
    "No Hatches match those filters.": "没有符合筛选条件的 Hatch。",
    "Task, business, or industry...": "任务、业务或行业…",
    "Completed Hatches, verified delivery.": "已完成的 Hatch，交付均经验证。",

    // ── Auth ─────────────────────────────────────────────────────────────────
    "Log in to Hatch.": "登录 Hatch。",
    "Use your username or email to continue to your Hatch dashboard.": "使用用户名或邮箱登录你的 Hatch 面板。",
    "Username or email": "用户名或邮箱",
    "Quick test login": "快速测试登录",
    "No matching local account found. Create an account first for this MVP preview.": "未找到匹配的本地账户。请先在此 MVP 预览中创建账户。",
    "New to Hatch?": "第一次使用 Hatch？",
    "Create an account": "创建账户",
    "Create account": "创建账户",
    "Already have an account?": "已经有账户了？",
    "Set up your Hatch account.": "设置你的 Hatch 账户。",
    "Clients post Hatches. Hatchers hatch them.": "客户发布 Hatch，Hatcher 负责孵化。",
    "or use email": "或使用邮箱",
    "or create manually": "或手动创建",
    "or use a different account": "或使用其他账户",
    "Continue with Google": "使用 Google 继续",
    "Google login demo only": "Google 登录（仅演示）",
    "Microsoft login demo only": "Microsoft 登录（仅演示）",
    "Apple login demo only": "Apple 登录（仅演示）",
    "Social sign in options": "第三方登录选项",
    "Social sign up options": "第三方注册选项",
    "MVP preview: this only simulates account access locally.": "MVP 预览：仅在本地模拟账户访问。",
    "MVP preview: your account and the Google option are simulated locally on this device.": "MVP 预览：账户与 Google 选项均在本设备本地模拟。",
    "Posting as": "发布身份",
    "username": "用户名",

    // ── Hatcher application ──────────────────────────────────────────────────
    "Apply to build practical Hatches.": "申请成为 Hatcher，承接实际工作。",
    "Submit application": "提交申请",
    "Application received.": "申请已收到。",
    "Application progress": "申请进度",
    "Hatcher application": "Hatcher 申请",
    "Your Hatcher application summary will appear here after you apply.": "提交申请后，你的 Hatcher 申请摘要会显示在这里。",
    "View profile": "查看主页",
    "LinkedIn": "领英",
    "LinkedIn profile": "领英主页",
    "Growth path": "成长路径",
    "L4 strategy later.": "L4 策略类工作稍后开放。",
    "What helps": "哪些有帮助",
    "Hatcher Hatches": "Hatcher 的 Hatch",

    // ── Messages ─────────────────────────────────────────────────────────────
    "New message": "新消息",
    "Open Messages": "打开消息",
    "Conversations": "会话",
    "Conversation": "会话",
    "Filter conversations": "筛选会话",
    "Back to conversations": "返回会话列表",
    "Pick a conversation": "选择一个会话",
    "Choose a thread on the left, or start a new message.": "从左侧选择一个会话，或发起新消息。",
    "Loading conversation...": "正在加载会话…",
    "These are automatic updates from Hatch — replies aren't needed.": "这些是来自 Hatch 的自动通知 —— 无需回复。",
    "Write a message...": "写下你的消息…",
    "Write your message...": "写下你的消息…",
    "Message": "消息",
    "Subject": "主题",
    "To: the other person on this Hatch": "收件人：该 Hatch 的另一方",

    // ── Admin ────────────────────────────────────────────────────────────────
    "Admin · Hatcher applications": "管理员 · Hatcher 申请",
    "Admin · All Hatches": "管理员 · 全部 Hatch",
    "Admin · Send a message": "管理员 · 发送消息",
    "Send as direct message": "以私信方式发送",
    "No pending applications.": "没有待处理的申请。",
    "No Hatches to manage yet.": "暂时没有可管理的 Hatch。",
    "Optional message for the applicant's inbox": "发送到申请人收件箱的可选留言",

    // ── Settings ─────────────────────────────────────────────────────────────
    "Manage account": "账户管理",
    "Account settings.": "账户设置。",
    "Update how you appear across Hatch — your profile picture and display name.": "更新你在 Hatch 上的形象 —— 头像与显示名称。",
    "Profile picture": "头像",
    "Upload picture": "上传头像",
    "Replace picture": "更换头像",
    "Images are resized to a small square. Without one, your initials are shown.": "图片会被裁剪为小方图。未上传时显示姓名首字母。",
    "Display name": "显示名称",
    "Account": "账户",
    "Username": "用户名",
    "Email": "邮箱",
    "Role": "角色",
    "Username and email changes aren't available in this preview.": "本预览版暂不支持修改用户名和邮箱。",

    // ── Language picker ──────────────────────────────────────────────────────
    "Language": "语言",
    "Choose language": "选择语言",
    "Change language": "切换语言",
    "Hatch's interface language. Your Hatches and messages stay as written.": "Hatch 的界面语言。你的 Hatch 内容和消息将保持原文。",
    // Language names are deliberately absent: each is always shown in its own
    // language ("English", "中文") so a user stuck in the wrong one can find
    // their way back.

    // ── Static pages ─────────────────────────────────────────────────────────
    "How it works": "运作方式",
    "Post a Hatch. Incubate the work. Receive the Hatched solution.": "发布 Hatch，孵化工作，收获成果。",
    "Trust and ranking": "信任与排名",
    "Hatch Levels": "Hatch 等级",
    "Hatches are grouped by complexity so Hatchers build up from simpler work.": "Hatch 按复杂度分级，Hatcher 可从简单工作逐步进阶。",
    "Ranking Signals": "排名信号",
    "Profiles are ranked with delivery signals, not self-claimed expertise alone.": "排名依据交付表现，而非仅凭自述专长。",
    "Hatcher Trust": "Hatcher 信任度",
    "Hatcher cards show Hatched work, ratings, on-time delivery, and category context.": "Hatcher 卡片展示已孵化工作、评分、准时交付率和领域背景。",

    // ── Debug panel ──────────────────────────────────────────────────────────
    "Provider": "服务商",
    "Model": "模型",
    "Last response time": "上次响应时间",
    "Fallback used": "已使用回退",
    "Last intent": "上次意图",
    "Last user message": "上一条用户消息",
    "Fields updated": "已更新字段",
    "Next question": "下一个问题",
    "Duplicate blocked": "已拦截重复",
    "Last assistant source": "上次助手来源",
    "Raw DeepSeek response": "DeepSeek 原始响应",
  };

  const DICTIONARIES = { zh: ZH };

  // Attributes worth translating. Everything else (href, class, data-*) is
  // structural and must be left alone.
  const ATTRS = ["placeholder", "title", "aria-label", "alt"];
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE"]);

  let current = read();

  function read() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return LANGUAGES.some((l) => l.code === stored) ? stored : DEFAULT_LANG;
    } catch {
      return DEFAULT_LANG;
    }
  }

  function getLang() {
    return current;
  }

  function languages() {
    return LANGUAGES.slice();
  }

  function languageOf(code) {
    return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
  }

  function setLang(code) {
    const next = LANGUAGES.some((l) => l.code === code) ? code : DEFAULT_LANG;
    if (next === current) return current;
    current = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private browsing — language stays for this session only */
    }
    applyDocumentLang();
    return current;
  }

  function applyDocumentLang() {
    document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
    document.documentElement.classList.toggle("lang-zh", current === "zh");
  }

  // Translate a single string. Unknown strings come back unchanged so dynamic
  // user content is never mangled.
  function t(text) {
    const dict = DICTIONARIES[current];
    if (!dict) return text;
    return dict[text] ?? text;
  }

  function translateTextNode(node) {
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) return;
    // Preserve the node's surrounding whitespace — it carries inline spacing
    // between adjacent elements.
    const match = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const [, lead, body, trail] = match;
    const translated = t(body.replace(/\s+/g, " "));
    if (translated !== body) node.nodeValue = `${lead}${translated}${trail}`;
  }

  function translateAttributes(el) {
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const translated = t(value.trim());
      if (translated !== value.trim()) el.setAttribute(attr, translated);
    }
    if (el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type) && el.value) {
      const translated = t(el.value.trim());
      if (translated !== el.value.trim()) el.value = translated;
    }
  }

  // Walk `root` and translate in place. Safe to call on any freshly-rendered
  // subtree; a no-op when the language is English.
  function apply(root = document.body) {
    applyDocumentLang();
    if (current === DEFAULT_LANG || !root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (SKIP_TAGS.has(node.tagName) || node.hasAttribute("data-no-i18n")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
      node = walker.nextNode();
    }
  }

  applyDocumentLang();

  return { apply, getLang, setLang, languages, languageOf, t };
})();
