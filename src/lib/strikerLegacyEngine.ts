import { fetchLeagueQuiz, fetchPlayerQuiz, sendAiChatMessage } from "./genlayerBrowser";

declare const marked:
  | {
      setOptions: (options: { breaks: boolean; gfm: boolean }) => void
      parse: (value: string) => string
    }
  | undefined

declare global {
  interface Window {
    __strikerlabBooted?: boolean
    navigate?: (page: string, params?: Record<string, unknown>) => void
    cycleTheme?: () => void
    selectDifficulty?: (level: string) => void
    selectCount?: (count: number) => void
    startQuiz?: () => Promise<void>
    jumpToQuestion?: (index: number) => void
    goToPrevQuestion?: () => void
    goToNextQuestion?: () => void
    skipQuestion?: () => void
    confirmQuit?: () => void
    retryQuiz?: () => void
    searchPlayer?: () => void
    selectPlayer?: (name: string) => void
    startPlayerQuiz?: (playerName: string, difficulty: string) => Promise<void>
    askSuggestion?: (text: string) => void
    clearChat?: () => void
    sendChatMessage?: () => Promise<void>
  }
}

// strikerlab - Main Application
// ===============================

// ---- MARKDOWN RENDERER ----
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    try {
      // Configure marked for safe rendering
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(text);
    } catch(e) {}
  }
  // Fallback: convert basic markdown
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold mt-3 mb-1">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold mt-2 mb-1">$1</h3>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDynamicJson(value) {
  if (value === null || value === undefined) {
    return '<span class="text-slate-400">null</span>';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `<span>${escapeHtml(value)}</span>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="text-slate-400">[]</span>';
    return `<ul class="space-y-1">${value.map((item) => `<li class="rounded-lg bg-slate-100 dark:bg-slate-800/70 px-2 py-1">${renderDynamicJson(item)}</li>`).join('')}</ul>`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '<span class="text-slate-400">{}</span>';
    return `<div class="space-y-1.5">${entries.map(([key, val]) => `
      <div class="rounded-lg border border-slate-200 dark:border-slate-700/60 p-2">
        <div class="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">${escapeHtml(key)}</div>
        <div class="text-sm text-slate-700 dark:text-slate-200">${renderDynamicJson(val)}</div>
      </div>
    `).join('')}</div>`;
  }
  return `<span>${escapeHtml(String(value))}</span>`;
}

// ---- THEME MANAGEMENT ----
const ThemeManager = {
  init() {
    const saved = localStorage.getItem('fiq_theme') || 'system';
    this.apply(saved);
  },
  apply(theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      // system
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
    localStorage.setItem('fiq_theme', theme);
    AppState.theme = theme;
  },
  get() {
    return localStorage.getItem('fiq_theme') || 'system';
  }
};

// ---- APP STATE ----
const AppState = {
  currentPage: 'landing',
  theme: 'system',
  quiz: {
    questions: [],
    current: 0,
    score: 0,
    answers: [],
    category: '',
    difficulty: 'medium',
    playerName: '',
    timeLeft: 30,
    timer: null,
    started: false,
    finished: false
  },
  leagues: [],
  players: [],
  chat: {
    history: [],
    loading: false
  }
};

// ---- ROUTER ----
function navigate(page, params = {}) {
  Object.assign(AppState, params);
  AppState.currentPage = page;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- RENDER ENGINE ----
function render() {
  const app = document.getElementById('striker-root');
  if (!app) return;

  let html = '';
  switch (AppState.currentPage) {
    case 'landing': html = renderLanding(); break;
    case 'home': html = renderHome(); break;
    case 'leagues': html = renderLeaguesPage(); break;
    case 'quiz-setup': html = renderQuizSetup(); break;
    case 'quiz': html = renderQuiz(); break;
    case 'quiz-result': html = renderQuizResult(); break;
    case 'players': html = renderPlayersPage(); break;
    case 'ai': html = renderAIPage(); break;
    case 'about': html = renderAbout(); break;
    default: html = renderLanding();
  }

  app.innerHTML = html;
  attachEventListeners();
}

// ---- NAV HTML ----
function renderNav(activePage) {
  const isDark = document.documentElement.classList.contains('dark');
  const themeIcon = isDark ? 'fa-sun' : 'fa-moon';
  const themeLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  const navItems = [
    { page: 'home', icon: 'fa-house', label: 'Home' },
    { page: 'leagues', icon: 'fa-trophy', label: 'Leagues' },
    { page: 'players', icon: 'fa-user-group', label: 'Players' },
    { page: 'ai', icon: 'fa-robot', label: 'AI Chat' },
  ];

  const navLinks = navItems.map(item => `
    <button onclick="navigate('${item.page}')"
      class="nav-link flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all ${activePage === item.page ? 'nav-link-active' : ''}">
      <i class="fas ${item.icon} text-xs"></i>
      <span class="hidden sm:inline">${item.label}</span>
    </button>
  `).join('');

  return `
  <nav class="sticky top-0 z-50 px-4 sm:px-6 pt-4">
    <div class="max-w-7xl mx-auto">
      <div class="top-nav glass">
        <button onclick="navigate('landing')" class="nav-brand">
          <span class="brand-mark text-[0.72rem] font-black tracking-[0.08em]">SF</span>
          <span class="font-black text-base sm:text-lg tracking-tight">
            <span class="text-gray-100">StrikerForge</span><span class="text-gray-300">Lab</span>
          </span>
        </button>

        <div class="flex items-center gap-1 sm:gap-2">
          ${navLinks}
          <button onclick="cycleTheme()" title="Theme: ${themeLabel}" class="theme-toggle nav-theme">
            <i class="fas ${themeIcon}"></i>
          </button>
        </div>
      </div>
    </div>
  </nav>`;
}

function cycleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  const next = isDark ? 'light' : 'dark';
  ThemeManager.apply(next);
  render();
}

// ---- LANDING PAGE ----
function renderLanding() {
  const topLinks = [
    { label: 'HOME', action: "navigate('landing')" },
    { label: 'QUIZ', action: "navigate('home')" },
    { label: 'LEADERBOARD', action: "navigate('leagues')" },
    { label: 'ABOUT', action: "navigate('about')" },
  ];

  return `
  <div class="min-h-screen landing-shell landing-reference relative overflow-hidden">
    <div class="landing-arc landing-arc-left"></div>
    <div class="landing-arc landing-arc-right"></div>
    <div class="landing-floor"></div>

    <main class="relative z-10 max-w-6xl mx-auto px-4 pt-8 pb-10 text-center page-enter">
      <div class="landing-brand-wrap slide-up">
        <div class="landing-emblem">SF</div>
        <div class="landing-brand-text">STRIKERFORGE LAB</div>
      </div>

      <div class="landing-menu slide-up" style="animation-delay:0.05s">
        ${topLinks.map(link => `
          <button onclick="${link.action}" class="landing-menu-link">${link.label}</button>
        `).join('<span class="landing-sep">|</span>')}
      </div>

      <h1 class="landing-title slide-up" style="animation-delay:0.1s">TEST YOUR FOOTBALL KNOWLEDGE!</h1>
      <p class="landing-subtitle slide-up" style="animation-delay:0.15s">Are You a True Football Legend? Prove It Now.</p>

      <section class="landing-mosaic slide-up" style="animation-delay:0.2s">
        <div class="landing-tile"><i class="fas fa-gear"></i><span>History</span></div>
        <div class="landing-tile"><i class="fas fa-shield"></i><span>Stats</span></div>
        <div class="landing-ball-tile"><span>⚽</span></div>
        <div class="landing-tile"><i class="fas fa-bullhorn"></i><span>Trivia</span></div>
        <div class="landing-tile"><i class="fas fa-trophy"></i><span>Categories</span></div>
      </section>

      <button onclick="navigate('home')" class="landing-cta slide-up" style="animation-delay:0.25s">
        START THE QUIZ NOW
      </button>

      <p class="landing-featured slide-up" style="animation-delay:0.3s">
        Featured Quizzes: World Cup History | Premier League Heroes | Ballon d'Or Winners
      </p>

      <div class="landing-social slide-up" style="animation-delay:0.35s">
        <button onclick="navigate('home')" aria-label="Quiz"><i class="fas fa-futbol"></i></button>
        <button onclick="navigate('ai')" aria-label="AI"><i class="fas fa-robot"></i></button>
        <button onclick="navigate('players')" aria-label="Players"><i class="fas fa-user-group"></i></button>
      </div>

    </main>
  </div>`;
}
// ---- HOME PAGE ----
function renderHome() {
  return `
  ${renderNav('home')}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 py-8 page-enter">
    <section class="mb-10">
      <div class="flex items-center justify-between mb-5">
        <h2 class="section-heading">Quick Play</h2>
        <button onclick="navigate('leagues')" class="text-sm font-semibold text-gray-500 hover:text-gray-400 transition-colors">View all leagues</button>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${[
          { id: 'champions_league', name: 'Champions League', flag: '🏆', color: 'from-slate-800 to-gray-700', desc: 'Europe\'s elite competition' },
          { id: 'premier_league', name: 'Premier League', flag: '🏴', color: 'from-gray-700 to-gray-700', desc: 'The world\'s most watched league' },
          { id: 'players', name: 'Player Knowledge', flag: '⭐', color: 'from-gray-500 to-gray-600', desc: 'Test your player expertise' },
          { id: 'la_liga', name: 'La Liga', flag: '🇪🇸', color: 'from-gray-600 to-gray-500', desc: 'Spain\'s top football division' },
          { id: 'managers', name: 'Managers & Tactics', flag: '🎩', color: 'from-slate-700 to-slate-900', desc: 'How well do you know elite managers?' },
          { id: 'trophies', name: 'Trophies & Records', flag: '🏅', color: 'from-gray-600 to-gray-600', desc: 'Historic achievements and milestones' },
        ].map(q => `
          <button onclick="navigate('quiz-setup', { quizCategory: '${q.id}', quizName: '${q.name}' })"
            class="quick-play-card card-hover bg-gradient-to-br ${q.color}">
            <span class="quick-play-flag">${q.flag}</span>
            <h3 class="font-bold text-lg text-white mb-1">${q.name}</h3>
            <p class="text-white/75 text-sm">${q.desc}</p>
            <div class="mt-4 text-xs uppercase tracking-wide text-white/80 flex items-center gap-1">
              <i class="fas fa-play-circle"></i> Start
            </div>
          </button>
        `).join('')}
      </div>
    </section>

  </div>
  ${renderFooter()}`;
}
// ---- LEAGUES PAGE ----
function renderLeaguesPage() {
  const leagueCards = [
    { id: 'premier_league', name: 'Premier League', country: 'England', flag: '🏴', bg: 'league-card-pl', clubs: 'Arsenal, Chelsea, Man City, Liverpool...' },
    { id: 'la_liga', name: 'La Liga', country: 'Spain', flag: '🇪🇸', bg: 'league-card-ll', clubs: 'Real Madrid, Barcelona, Atletico...' },
    { id: 'serie_a', name: 'Serie A', country: 'Italy', flag: '🇮🇹', bg: 'league-card-sa', clubs: 'Juventus, Inter, AC Milan, Roma...' },
    { id: 'bundesliga', name: 'Bundesliga', country: 'Germany', flag: '🇩🇪', bg: 'league-card-bl', clubs: 'Bayern Munich, Dortmund, RB Leipzig...' },
    { id: 'ligue_1', name: 'Ligue 1', country: 'France', flag: '🇫🇷', bg: 'league-card-l1', clubs: 'PSG, Monaco, Lyon, Marseille...' },
    { id: 'primeira_liga', name: 'Primeira Liga', country: 'Portugal', flag: '🇵🇹', bg: 'league-card-pl2', clubs: 'Benfica, Porto, Sporting CP...' },
    { id: 'eredivisie', name: 'Eredivisie', country: 'Netherlands', flag: '🇳🇱', bg: 'league-card-er', clubs: 'Ajax, PSV, Feyenoord, AZ...' },
    { id: 'belgian_pro', name: 'Belgian Pro League', country: 'Belgium', flag: '🇧🇪', bg: 'league-card-bp', clubs: 'Anderlecht, Club Brugge, Gent...' },
    { id: 'mls', name: 'Major League Soccer', country: 'USA 🇺🇸 / Canada', flag: '🇺🇸', bg: 'league-card-mls', clubs: 'Inter Miami, LA Galaxy, NYCFC...' },
    { id: 'super_lig', name: 'Süper Lig', country: 'Turkey', flag: '🇹🇷', bg: 'league-card-sl', clubs: 'Galatasaray, Fenerbahce, Besiktas...' },
    { id: 'champions_league', name: 'UEFA Champions League', country: 'Europe', flag: '🌍', bg: 'league-card-cl', clubs: 'Best clubs across Europe compete' },
    { id: 'managers', name: 'Managers & Bosses', country: 'Worldwide', flag: '🎩', bg: 'from-slate-700 to-slate-900', clubs: 'Ferguson, Guardiola, Mourinho...' },
    { id: 'trophies', name: 'Trophies & Records', country: 'Worldwide', flag: '🏅', bg: 'from-gray-600 to-gray-600', clubs: 'World Cups, domestic trophies, records' },
  ];

  return `
  ${renderNav('leagues')}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 py-8 page-enter">
    <section class="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
      <div>
        <h1 class="text-3xl md:text-4xl font-black text-slate-900 dark:text-white mb-2">Choose Your Arena</h1>
        <p class="text-slate-500 dark:text-slate-400">Pick a competition and launch a focused quiz session.</p>
      </div>
      <button onclick="navigate('home')" class="btn-secondary px-5 py-2.5 rounded-xl text-sm font-semibold">Back to Home</button>
    </section>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      ${leagueCards.map((l, i) => `
        <button onclick="navigate('quiz-setup', { quizCategory: '${l.id}', quizName: '${l.name}' })"
          class="league-tile card-hover ${l.bg.includes('from-') ? 'bg-gradient-to-br ' + l.bg : l.bg} slide-up"
          style="animation-delay: ${i * 0.04}s">
          <div class="flex items-start justify-between mb-4">
            <span class="text-4xl">${l.flag}</span>
            <span class="league-country">${l.country}</span>
          </div>
          <h3 class="font-bold text-lg text-white mb-1 text-left">${l.name}</h3>
          <p class="text-white/75 text-sm mb-4 text-left">${l.clubs}</p>
          <div class="flex items-center justify-between">
            <div class="flex gap-2 text-[11px] uppercase tracking-wide text-white/80">
              <span>Easy</span><span>Medium</span><span>Hard</span>
            </div>
            <i class="fas fa-arrow-right text-white/70"></i>
          </div>
        </button>
      `).join('')}
    </div>
  </div>
  ${renderFooter()}`;
}
// ---- QUIZ SETUP PAGE ----
function renderQuizSetup() {
  const category = AppState.quizCategory || 'champions_league';
  const name = AppState.quizName || 'Champions League';
  const presetDiff = AppState.selectedDifficulty || null;

  return `
  ${renderNav('leagues')}
  <div class="max-w-3xl mx-auto px-4 sm:px-6 py-10 page-enter">
    <button onclick="navigate('home')" class="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-gray-500 mb-6 transition-colors">
      <i class="fas fa-arrow-left"></i> Back to Home
    </button>

    <div class="modern-surface overflow-hidden">
      <div class="setup-head p-8 text-white relative overflow-hidden">
        <div class="field-pattern absolute inset-0 opacity-25"></div>
        <div class="relative z-10 flex items-center justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-gray-200 mb-2">Quiz Setup</p>
            <h2 class="text-2xl md:text-3xl font-black mb-1">${name}</h2>
            <p class="text-gray-100 text-sm">Select difficulty and question count to begin.</p>
          </div>
          <div class="text-5xl float-anim">⚽</div>
        </div>
      </div>

      <div class="p-6 md:p-8">
        <h3 class="text-lg font-bold text-slate-100 mb-4">Select Difficulty</h3>
        <div class="grid md:grid-cols-3 gap-3 mb-8" id="diff-selector">
          ${[
            { level: 'easy', icon: '🌱', label: 'Easy', desc: 'For beginners' },
            { level: 'medium', icon: '🔥', label: 'Medium', desc: 'For regular fans' },
            { level: 'hard', icon: '💀', label: 'Hard', desc: 'Experts only' },
          ].map(d => `
            <button onclick="selectDifficulty('${d.level}')" id="diff-${d.level}"
              class="difficulty-card ${presetDiff === d.level ? `is-selected is-${d.level}` : ''}">
              <span class="difficulty-icon">${d.icon}</span>
              <span class="difficulty-label">${d.label}</span>
              <span class="difficulty-desc">${d.desc}</span>
            </button>
          `).join('')}
        </div>

        <div id="question-count-section" class="mb-7">
          <h3 class="text-lg font-bold text-slate-100 mb-3">Number of Questions</h3>
          <div class="grid grid-cols-3 gap-3">
            ${[5,10,15].map(n => `
              <button onclick="selectCount(${n})" id="count-${n}" class="count-pill ${n === 10 ? 'is-selected' : ''}">
                ${n}
              </button>
            `).join('')}
          </div>
        </div>

        <button id="start-quiz-btn" onclick="startQuiz()"
          class="w-full py-4 btn-primary rounded-2xl text-white font-bold text-lg flex items-center justify-center gap-3 ${presetDiff ? '' : 'is-disabled'}"
          ${presetDiff ? '' : 'disabled'}>
          <i class="fas fa-play"></i> Start Quiz
        </button>
      </div>
    </div>
  </div>
  ${renderFooter()}`;
}

let selectedDiff = null;
let selectedCount = 10;

function selectDifficulty(level) {
  selectedDiff = level;
  AppState.selectedDifficulty = level;

  ['easy', 'medium', 'hard'].forEach(l => {
    const el = document.getElementById(`diff-${l}`);
    if (!el) return;
    el.classList.remove('is-selected', 'is-easy', 'is-medium', 'is-hard');
    if (l === level) {
      el.classList.add('is-selected', `is-${l}`);
    }
  });

  const btn = document.getElementById('start-quiz-btn');
  if (btn) {
    btn.disabled = false;
    btn.classList.remove('is-disabled');
  }
}

function selectCount(n) {
  selectedCount = n;
  [5,10,15].forEach(c => {
    const el = document.getElementById(`count-${c}`);
    if (!el) return;
    el.classList.toggle('is-selected', c === n);
  });
}

async function startQuiz() {
  const diff = selectedDiff || AppState.selectedDifficulty;
  if (!diff) { alert('Please select a difficulty!'); return; }

  const cat = AppState.quizCategory || 'champions_league';
  const count = selectedCount || 10;
  const startBtn = document.getElementById('start-quiz-btn');
  const originalBtnHtml = startBtn ? startBtn.innerHTML : '';
  let navigatedToQuiz = false;

  if (startBtn) {
    startBtn.setAttribute('disabled', 'true');
    startBtn.classList.add('is-disabled');
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting Quiz...';
  }

  try {
    const res = await fetchLeagueQuiz({ category: cat, difficulty: diff, count });
    const { questions } = res;

    if (!questions || questions.length === 0) {
      alert('No questions available for this selection. Try another league or difficulty.');
      return;
    }

    AppState.quiz = {
      questions,
      current: 0,
      score: 0,
      answers: [],
      category: cat,
      difficulty: diff,
      playerName: AppState.playerName || '',
      timeLeft: diff === 'easy' ? 45 : diff === 'medium' ? 30 : 20,
      maxTime: diff === 'easy' ? 45 : diff === 'medium' ? 30 : 20,
      timer: null,
      started: true,
      finished: false,
      name: AppState.quizName || cat
    };

    navigatedToQuiz = true;
    navigate('quiz');
  } catch (e) {
    console.error(e);
    alert('Failed to load questions. Please try again.');
  } finally {
    if (!navigatedToQuiz && startBtn) {
      startBtn.removeAttribute('disabled');
      startBtn.classList.remove('is-disabled');
      startBtn.innerHTML = originalBtnHtml;
    }
  }
}

// ---- QUIZ PAGE ----
function renderQuiz() {
  const q = AppState.quiz;
  if (!q.started || q.questions.length === 0) {
    navigate('home');
    return '';
  }

  const question = q.questions[q.current];
  const timePercent = (q.timeLeft / q.maxTime) * 100;
  const timerColor = q.timeLeft <= 5 ? 'text-gray-500' : q.timeLeft <= 10 ? 'text-gray-500' : 'text-gray-500';
  const timerBg   = q.timeLeft <= 5 ? 'bg-gray-500'   : q.timeLeft <= 10 ? 'bg-gray-500'   : 'bg-gray-500';
  const diffBadge = { easy: 'badge-easy', medium: 'badge-medium', hard: 'badge-hard' };
  const diffEmoji = { easy: '🌱', medium: '🔥', hard: '💀' };

  const currentAnswer = q.answers[q.current];
  const isAnswered = currentAnswer !== undefined;

  const canGoBack = q.current > 0;
  const canGoForward = q.current < q.questions.length - 1;

  return `
  ${renderNav('leagues')}
  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 page-enter">
    <div class="modern-surface p-4 md:p-5 mb-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-2">
          <span class="text-xl font-black text-slate-100">Q${q.current + 1}<span class="text-slate-400 font-semibold">/${q.questions.length}</span></span>
          <span class="px-3 py-1 rounded-full text-white text-xs font-bold ${diffBadge[q.difficulty]}">
            ${diffEmoji[q.difficulty]} ${q.difficulty.toUpperCase()}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-500/10 border border-gray-500/25 text-gray-400">
            <i class="fas fa-star text-xs"></i>
            <span id="score-display" class="font-bold stat-number">${q.score}</span>
          </div>
          <div id="timer-display" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-500/10 border border-slate-500/25 font-bold ${timerColor} ${q.timeLeft <= 5 ? 'timer-urgent' : ''}">
            <i class="fas fa-clock text-xs"></i>
            <span>${q.timeLeft}s</span>
          </div>
        </div>
      </div>

      <div class="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
        <div class="h-full ${timerBg} rounded-full progress-bar transition-all duration-1000" id="timer-bar" style="width:${timePercent}%"></div>
      </div>

      <div class="flex gap-1.5 mt-4 overflow-x-auto pb-1">
        ${q.questions.map((_, i) => {
          const ans = q.answers[i];
          let dotClass = 'bg-slate-300 dark:bg-slate-700 cursor-pointer hover:scale-125';
          let title = `Go to Q${i+1}`;
          if (i === q.current) {
            dotClass = 'bg-gray-500 scale-125 ring-2 ring-gray-300 cursor-default';
          } else if (ans !== undefined) {
            dotClass = (ans === q.questions[i].answer ? 'bg-gray-500' : 'bg-gray-500') + ' cursor-pointer hover:scale-110';
            title = ans === q.questions[i].answer ? `Q${i+1} ✓ Correct` : `Q${i+1} ✗ Wrong`;
          }
          return `<div onclick="jumpToQuestion(${i})" title="${title}" class="flex-shrink-0 w-3 h-3 rounded-full transition-all ${dotClass}"></div>`;
        }).join('')}
      </div>
    </div>

    <div class="modern-surface p-6 md:p-8 mb-4 slide-up">
      <div class="flex items-start gap-3 mb-6">
        <div class="w-8 h-8 rounded-full bg-gray-500/20 text-gray-300 flex items-center justify-center flex-shrink-0 mt-0.5 font-bold text-sm">${q.current + 1}</div>
        <p class="text-lg md:text-xl font-semibold text-slate-100 leading-relaxed">${question.question}</p>
      </div>

      <div class="grid gap-3" id="options-container">
        ${question.options.map((opt, i) => {
          const letters = ['A', 'B', 'C', 'D'];
          let btnClass = 'quiz-option w-full text-left p-4 rounded-2xl border-2 flex items-center gap-3 transition-all';
          let letterClass = 'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0';
          let disabled = '';

          if (isAnswered) {
            disabled = 'disabled';
            if (opt === question.answer) {
              btnClass += ' border-gray-500 bg-gray-50 dark:bg-gray-900/30 text-slate-900 dark:text-slate-100';
              letterClass += ' bg-gray-500 text-white';
            } else if (opt === currentAnswer) {
              btnClass += ' border-gray-500 bg-gray-50 dark:bg-gray-900/30 text-slate-900 dark:text-slate-100';
              letterClass += ' bg-gray-500 text-white';
            } else {
              btnClass += ' border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-500 opacity-60';
              letterClass += ' bg-slate-200 dark:bg-slate-700 text-slate-500';
            }
          } else {
            btnClass += ' border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 hover:border-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900/20 text-slate-800 dark:text-slate-200 cursor-pointer';
            letterClass += ' bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400';
          }

          return `
            <button onclick="${isAnswered ? '' : `selectAnswer('${opt.replace(/'/g, "\\'")}')`}" id="opt-${i}"
              class="${btnClass}" ${disabled}>
              <span class="${letterClass}">${isAnswered && opt === question.answer ? '✓' : isAnswered && opt === currentAnswer ? '✗' : letters[i]}</span>
              <span class="font-medium">${opt}</span>
              ${isAnswered && opt === question.answer ? '<span class="ml-auto text-gray-500 text-sm font-bold">✓ Correct</span>' : ''}
            </button>`;
        }).join('')}
      </div>

      ${isAnswered && question.explanation ? `
        <div class="mt-4 p-3 bg-gray-50 dark:bg-gray-900/25 rounded-xl text-gray-700 dark:text-gray-300 text-sm flex items-start gap-2">
          <i class="fas fa-lightbulb mt-0.5 flex-shrink-0"></i>
          <span>${question.explanation}</span>
        </div>` : ''}
    </div>

    <div class="modern-surface p-3 md:p-4">
      <div class="flex items-center gap-3">
        <button onclick="goToPrevQuestion()"
          class="flex items-center gap-2 px-4 py-3 rounded-2xl border font-semibold text-sm transition-all ${canGoBack ? 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-gray-400 hover:text-gray-500 bg-white/80 dark:bg-slate-900/60' : 'border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-700 cursor-not-allowed bg-slate-100 dark:bg-slate-900/40'}">
          <i class="fas fa-chevron-left"></i>
          <span class="hidden sm:inline">Back</span>
        </button>

        <div class="flex-1 text-center text-sm">
          ${isAnswered
            ? (currentAnswer === question.answer
                ? '<span class="text-gray-500 font-semibold">✓ Correct!</span>'
                : `<span class="text-gray-500 font-semibold">✗ Correct: ${question.answer}</span>`)
            : `<span class="text-slate-500">Question ${q.current + 1} of ${q.questions.length}</span>`}
        </div>

        ${isAnswered
          ? `<button onclick="goToNextQuestion()" class="flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-sm btn-primary text-white transition-all">
               <span class="hidden sm:inline">${canGoForward ? 'Next' : 'Finish'}</span>
               <i class="fas fa-chevron-right"></i>
             </button>`
          : `<button onclick="skipQuestion()" class="flex items-center gap-2 px-4 py-3 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold text-sm text-slate-600 dark:text-slate-400 hover:border-gray-400 hover:text-gray-500 bg-white/80 dark:bg-slate-900/60 transition-all">
               <span class="hidden sm:inline">Skip</span>
               <i class="fas fa-forward"></i>
             </button>`}
      </div>
    </div>

    <div class="mt-4 text-center">
      <button onclick="confirmQuit()" class="text-slate-400 hover:text-gray-400 text-xs transition-colors inline-flex items-center gap-1">
        <i class="fas fa-xmark text-xs"></i> Quit quiz
      </button>
    </div>
  </div>`;
}
// Quiz timer management
let quizTimer = null;

function startTimer() {
  clearInterval(quizTimer);
  quizTimer = setInterval(() => {
    if (AppState.currentPage !== 'quiz') { clearInterval(quizTimer); return; }
    // Don't count down if question already answered
    if (AppState.quiz.answers[AppState.quiz.current] !== undefined) return;

    AppState.quiz.timeLeft--;
    const timePercent = (AppState.quiz.timeLeft / AppState.quiz.maxTime) * 100;
    const timerEl  = document.getElementById('timer-display');
    const timerBar = document.getElementById('timer-bar');

    if (timerEl) {
      timerEl.innerHTML = `<i class="fas fa-clock text-sm"></i><span>${AppState.quiz.timeLeft}s</span>`;
      const urgent = AppState.quiz.timeLeft <= 5;
      const amber  = AppState.quiz.timeLeft <= 10;
      timerEl.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-500/10 border border-slate-500/25 font-bold ${urgent ? 'text-gray-500 timer-urgent' : amber ? 'text-gray-500' : 'text-gray-500'}`;
      if (timerBar) {
        timerBar.style.width = `${timePercent}%`;
        timerBar.className = timerBar.className.replace(/bg-\w+-\d+/, urgent ? 'bg-gray-500' : amber ? 'bg-gray-500' : 'bg-gray-500');
      }
    }
    if (AppState.quiz.timeLeft <= 0) {
      clearInterval(quizTimer);
      autoSkipQuestion();
    }
  }, 1000);
}

function resetTimer() {
  AppState.quiz.timeLeft = AppState.quiz.maxTime;
}

function autoSkipQuestion() {
  const q = AppState.quiz;
  if (q.answers[q.current] === undefined) {
    q.answers[q.current] = null; // null = timed out / skipped
  }
  advanceAfterAnswer();
}

function skipQuestion() {
  clearInterval(quizTimer);
  autoSkipQuestion();
}

// ---- NAVIGATE QUESTIONS ----
function jumpToQuestion(idx) {
  clearInterval(quizTimer);
  AppState.quiz.current = idx;
  // Reset timer only if that question hasn't been answered yet
  if (AppState.quiz.answers[idx] === undefined) {
    resetTimer();
    render();
    startTimer();
  } else {
    render();
  }
}

function goToPrevQuestion() {
  const q = AppState.quiz;
  if (q.current === 0) return;
  clearInterval(quizTimer);
  q.current--;
  if (q.answers[q.current] === undefined) {
    resetTimer();
    render();
    startTimer();
  } else {
    render();
  }
}

function goToNextQuestion() {
  const q = AppState.quiz;
  clearInterval(quizTimer);
  if (q.current < q.questions.length - 1) {
    q.current++;
    if (q.answers[q.current] === undefined) {
      resetTimer();
      render();
      startTimer();
    } else {
      render();
    }
  } else {
    // Check for any unanswered questions
    const firstUnanswered = q.questions.findIndex((_, i) => q.answers[i] === undefined);
    if (firstUnanswered !== -1) {
      // Jump to first unanswered
      q.current = firstUnanswered;
      resetTimer();
      render();
      startTimer();
    } else {
      // All answered → show results
      finishQuiz();
    }
  }
}

function advanceAfterAnswer() {
  const q = AppState.quiz;
  // Check if all questions are answered
  const allAnswered = q.questions.every((_, i) => q.answers[i] !== undefined);
  if (allAnswered) {
    setTimeout(finishQuiz, 900);
    return;
  }
  // Find next unanswered
  let nextIdx = q.current + 1;
  while (nextIdx < q.questions.length && q.answers[nextIdx] !== undefined) nextIdx++;
  if (nextIdx >= q.questions.length) {
    nextIdx = q.questions.findIndex((_, i) => q.answers[i] === undefined);
  }
  if (nextIdx === -1 || nextIdx === q.current) {
    setTimeout(finishQuiz, 900);
  } else {
    setTimeout(() => {
      q.current = nextIdx;
      resetTimer();
      render();
      startTimer();
    }, 900);
  }
}

function finishQuiz() {
  clearInterval(quizTimer);
  AppState.quiz.finished = true;
  navigate('quiz-result');
}

function confirmQuit() {
  if (confirm('Quit this quiz? Your progress will be lost.')) {
    clearInterval(quizTimer);
    navigate('home');
  }
}

function selectAnswer(answer) {
  clearInterval(quizTimer);
  const q = AppState.quiz;
  // Prevent re-answering
  if (q.answers[q.current] !== undefined) return;

  const question = q.questions[q.current];
  const isCorrect = answer === question.answer;
  if (isCorrect) q.score++;
  q.answers[q.current] = answer;

  // Re-render to show result state immediately
  render();

  // Update score display
  const scoreEl = document.getElementById('score-display');
  if (scoreEl && isCorrect) {
    scoreEl.classList.add('score-update');
    scoreEl.textContent = q.score;
    setTimeout(() => scoreEl.classList.remove('score-update'), 400);
  }
}

// ---- QUIZ RESULT PAGE ----
function renderQuizResult() {
  const q = AppState.quiz;
  const pct = Math.round((q.score / q.questions.length) * 100);
  const stars = pct >= 80 ? 3 : pct >= 50 ? 2 : 1;

  let grade, gradeColor, gradeMsg;
  if (pct >= 90) { grade = 'Elite'; gradeColor = 'text-gray-400'; gradeMsg = 'Outstanding football intelligence.'; }
  else if (pct >= 70) { grade = 'Pro'; gradeColor = 'text-gray-400'; gradeMsg = 'Strong football knowledge.'; }
  else if (pct >= 50) { grade = 'Amateur'; gradeColor = 'text-gray-400'; gradeMsg = 'Solid effort, keep building.'; }
  else { grade = 'Rookie'; gradeColor = 'text-slate-400'; gradeMsg = 'More reps and you will improve fast.'; }

  if (pct >= 70) {
    setTimeout(launchConfetti, 300);
  }

  return `
  ${renderNav('leagues')}
  <div class="max-w-3xl mx-auto px-4 sm:px-6 py-10 page-enter">
    <div class="modern-surface overflow-hidden">
      <div class="result-head p-8 md:p-10 text-center text-white">
        <div class="flex justify-center gap-3 mb-4">
          ${Array.from({length: 3}, (_, i) => `
            <span class="result-star text-4xl ${i < stars ? 'text-gray-300' : 'text-white/30'}" style="animation-delay:${i*0.15}s">★</span>
          `).join('')}
        </div>
        <div class="text-6xl font-black mb-2">${pct}%</div>
        <div class="text-xl font-bold mb-1 ${gradeColor}">${grade}</div>
        <p class="text-slate-200 text-sm md:text-base">${gradeMsg}</p>
      </div>

      <div class="p-6 md:p-8">
        <div class="grid grid-cols-3 gap-3 mb-8">
          ${[
            { label: 'Correct', val: q.score, icon: '✅', color: 'text-gray-500' },
            { label: 'Wrong', val: q.questions.length - q.score, icon: '❌', color: 'text-gray-500' },
            { label: 'Total', val: q.questions.length, icon: '❓', color: 'text-gray-500' },
          ].map(s => `
            <div class="text-center p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <div class="text-2xl mb-1">${s.icon}</div>
              <div class="text-2xl font-bold ${s.color}">${s.val}</div>
              <div class="text-xs text-slate-500 uppercase tracking-wide">${s.label}</div>
            </div>
          `).join('')}
        </div>

        <h3 class="font-bold text-slate-100 mb-3">Question Review</h3>
        <div class="space-y-3 mb-8 max-h-64 overflow-y-auto pr-1">
          ${q.questions.map((qst, i) => {
            const userAns = q.answers[i];
            const correct = userAns === qst.answer;
            return `
              <div class="flex gap-3 p-3 rounded-xl border ${correct ? 'border-gray-500/30 bg-gray-500/10' : 'border-gray-500/30 bg-gray-500/10'} text-sm">
                <span class="flex-shrink-0 text-lg">${correct ? '✅' : '❌'}</span>
                <div>
                  <p class="font-medium text-slate-100 text-xs mb-1">${qst.question}</p>
                  ${!correct ? `<p class="text-gray-400 text-xs">Your answer: ${userAns || 'Skipped'}</p>` : ''}
                  <p class="text-gray-300 text-xs">Answer: ${qst.answer}</p>
                </div>
              </div>`;
          }).join('')}
        </div>

        <div class="flex flex-col sm:flex-row gap-3">
          <button onclick="retryQuiz()" class="flex-1 py-3 btn-primary text-white rounded-2xl font-bold flex items-center justify-center gap-2">
            <i class="fas fa-redo"></i> Try Again
          </button>
          <button onclick="navigate('leagues')" class="flex-1 py-3 btn-secondary rounded-2xl font-bold flex items-center justify-center gap-2">
            <i class="fas fa-list"></i> More Leagues
          </button>
        </div>
      </div>
    </div>
  </div>
  ${renderFooter()}`;
}
function retryQuiz() {
  AppState.selectedDifficulty = AppState.quiz.difficulty;
  selectedDiff = AppState.quiz.difficulty;
  navigate('quiz-setup');
}

function launchConfetti() {
  const colors = ['#f5f5f5', '#d4d4d4', '#a3a3a3', '#737373', '#262626'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    el.style.cssText = `
      left: ${Math.random() * 100}vw;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration: ${1.5 + Math.random() * 2}s;
      animation-delay: ${Math.random() * 0.5}s;
      width: ${6 + Math.random() * 10}px;
      height: ${6 + Math.random() * 10}px;
      top: -20px;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

// ---- PLAYERS PAGE ----
function renderPlayersPage() {
  const popular = [
    'Lionel Messi', 'Cristiano Ronaldo', 'Erling Haaland', 'Kylian Mbappe',
    'Neymar', 'Kevin De Bruyne', 'Mohamed Salah', 'Vinicius Junior',
    'Jude Bellingham', 'Rodri', 'Harry Kane', 'Phil Foden',
    'Luka Modric', 'Robert Lewandowski', 'Virgil van Dijk', 'Pedri',
    'Bukayo Saka', 'Trent Alexander-Arnold', 'Gavi', 'Marcus Rashford'
  ];

  return `
  ${renderNav('players')}
  <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8 page-enter">
    <div class="mb-8">
      <h1 class="text-3xl md:text-4xl font-black text-slate-900 dark:text-white mb-2">Player Quiz Studio</h1>
      <p class="text-slate-500 dark:text-slate-400">Search any player and generate a focused quiz instantly.</p>
    </div>

    <section class="modern-surface p-6 mb-8">
      <h2 class="font-bold text-slate-100 mb-3 flex items-center gap-2">
        <i class="fas fa-search text-gray-400"></i> Search Any Player
      </h2>
      <div class="flex flex-col sm:flex-row gap-3">
        <input type="text" id="player-search-input" placeholder="e.g. Thierry Henry, Zinedine Zidane..."
          class="flex-1 px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70
                 text-slate-800 dark:text-slate-200 focus:outline-none search-input transition-all"
          onkeypress="if(event.key==='Enter') searchPlayer()">
        <button onclick="searchPlayer()" class="btn-primary px-6 py-3 rounded-xl text-white font-bold flex items-center justify-center gap-2">
          <i class="fas fa-search"></i>
          <span>Generate</span>
        </button>
      </div>
      <p class="text-slate-400 text-xs mt-2">AI builds custom football questions for the selected player.</p>
    </section>

    <section class="mb-8">
      <h2 class="section-heading mb-4">Popular Players</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        ${popular.map((p, i) => {
          const colors = ['bg-gray-500', 'bg-gray-500', 'bg-gray-500', 'bg-gray-500', 'bg-gray-500', 'bg-gray-500', 'bg-gray-500', 'bg-gray-500'];
          const color = colors[i % colors.length];
          return `
            <button onclick="selectPlayer('${p}')" class="modern-surface p-4 text-left card-hover group slide-up" style="animation-delay:${i*0.03}s">
              <div class="w-10 h-10 ${color} rounded-full flex items-center justify-center text-white font-bold text-sm mb-2">
                ${p.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
              </div>
              <div class="font-semibold text-slate-100 text-sm leading-tight">${p}</div>
              <div class="text-xs text-gray-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                <i class="fas fa-play text-xs"></i> Quiz me
              </div>
            </button>`;
        }).join('')}
      </div>
    </section>

    <section class="modern-surface p-6 text-center">
      <div class="text-4xl mb-3">🌐</div>
      <h3 class="font-bold text-xl text-white mb-2">General Player Quiz</h3>
      <p class="text-slate-300 mb-4 text-sm">Test your knowledge across all players in the database.</p>
      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        ${['easy','medium','hard'].map(d => `
          <button onclick="navigate('quiz-setup', {quizCategory:'players',quizName:'Player Knowledge',selectedDifficulty:'${d}'})"
            class="btn-secondary px-5 py-2 rounded-full text-sm font-bold transition-all">
            ${d === 'easy' ? '🌱' : d === 'medium' ? '🔥' : '💀'} ${d.charAt(0).toUpperCase()+d.slice(1)}
          </button>
        `).join('')}
      </div>
    </section>
  </div>
  ${renderFooter()}`;
}
function selectPlayer(name) {
  showPlayerDifficultyModal(name);
}

function searchPlayer() {
  const input = document.getElementById('player-search-input');
  const name = input?.value?.trim();
  if (!name) return;
  showPlayerDifficultyModal(name);
}

function showPlayerDifficultyModal(playerName) {
  const modal = document.createElement('div');
  modal.id = 'player-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm bounce-in';
  modal.innerHTML = `
    <div class="modern-surface rounded-3xl shadow-2xl p-8 max-w-sm w-full mx-4">
      <div class="text-center mb-6">
        <div class="text-5xl mb-3">⭐</div>
        <h3 class="text-xl font-black text-slate-100">${playerName}</h3>
        <p class="text-slate-400 text-sm mt-1">Choose your difficulty</p>
      </div>
      <div class="grid grid-cols-3 gap-3 mb-6">
        ${[
          { level: 'easy', icon: '🌱', label: 'Easy', color: 'bg-gray-500/10 text-gray-400 border-gray-500/40' },
          { level: 'medium', icon: '🔥', label: 'Medium', color: 'bg-gray-500/10 text-gray-400 border-gray-500/40' },
          { level: 'hard', icon: '💀', label: 'Hard', color: 'bg-gray-500/10 text-gray-400 border-gray-500/40' },
        ].map(d => `
          <button onclick="startPlayerQuiz('${playerName.replace(/'/g, "\\'")}','${d.level}')"
            class="p-3 rounded-2xl border ${d.color} text-center hover:scale-105 transition-all">
            <div class="text-2xl mb-1">${d.icon}</div>
            <div class="font-bold text-sm">${d.label}</div>
          </button>
        `).join('')}
      </div>
      <button onclick="document.getElementById('player-modal').remove()"
        class="w-full py-3 btn-secondary rounded-2xl font-bold transition-all">
        Cancel
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function startPlayerQuiz(playerName, difficulty) {
  document.getElementById('player-modal')?.remove();

  // Show loading overlay
  const loader = document.createElement('div');
  loader.id = 'quiz-loader';
  loader.className = 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm';
  loader.innerHTML = `
    <div class="text-center text-white">
      <div class="text-6xl mb-4 trophy-bounce">⚽</div>
      <div class="text-xl font-bold mb-2">Generating quiz for ${playerName}...</div>
      <div class="text-slate-300 text-sm">Powered by AI</div>
      <div class="mt-4 flex gap-2 justify-center">
        <div class="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
        <div class="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style="animation-delay:0.1s"></div>
        <div class="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style="animation-delay:0.2s"></div>
      </div>
    </div>`;
  document.body.appendChild(loader);

  try {
    const res = await fetchPlayerQuiz({ playerName, difficulty });
    const { questions } = res;

    loader.remove();

    if (!questions || questions.length === 0) {
      alert('Could not generate questions. Please try again.');
      return;
    }

    AppState.quiz = {
      questions,
      current: 0,
      score: 0,
      answers: [],
      category: 'players',
      difficulty,
      playerName,
      timeLeft: difficulty === 'easy' ? 45 : difficulty === 'medium' ? 30 : 20,
      maxTime: difficulty === 'easy' ? 45 : difficulty === 'medium' ? 30 : 20,
      timer: null,
      started: true,
      finished: false,
      name: `${playerName} Quiz`
    };

    navigate('quiz');
  } catch (e) {
    loader.remove();
    console.error(e);
    // Fallback to general players quiz
    AppState.quizCategory = 'players';
    AppState.quizName = `${playerName} Quiz`;
    AppState.selectedDifficulty = difficulty;
    selectedDiff = difficulty;
    await startQuiz();
  }
}

// ---- AI CHAT PAGE ----
function renderChatMessage(msg) {
  const isUser = msg.role === 'user';
  const parsedBlock = !isUser && msg.parsed && typeof msg.parsed === 'object'
    ? `<div class="mb-2">${renderDynamicJson(msg.parsed)}</div>`
    : '';
  const content = isUser
    ? `<span>${escapeHtml(msg.content)}</span>`
    : `${parsedBlock}<div class="prose prose-sm dark:prose-invert max-w-none ai-message-content">${renderMarkdown(msg.content || '')}</div>`;
  return `
    <div class="chat-message flex ${isUser ? 'justify-end' : 'justify-start'} gap-2">
      ${!isUser ? '<div class="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-500 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0 mt-1">🤖</div>' : ''}
      <div class="max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser ? 'bg-gray-500 text-white rounded-tr-sm' : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm'}">
        ${content}
      </div>
      ${isUser ? '<div class="w-8 h-8 bg-gradient-to-br from-slate-500 to-slate-700 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0 mt-1">👤</div>' : ''}
    </div>`;
}

function renderAIPage() {
  const chatHTML = AppState.chat.history.map(renderChatMessage).join('');

  const suggestions = [
    'Tell me about Lionel Messi\'s career',
    'Who has won the most Champions League titles?',
    'Compare Messi and Ronaldo',
    'What was the Miracle of Istanbul?',
    'Who is the greatest manager ever?',
    'Explain tiki-taka football',
    'Tell me about the 1986 World Cup',
    'How many goals has Haaland scored?'
  ];

  return `
  ${renderNav('ai')}
  <div class="max-w-5xl mx-auto px-4 sm:px-6 py-8 page-enter">
    <div class="mb-6">
      <h1 class="text-3xl md:text-4xl font-black text-slate-900 dark:text-white mb-2">Football AI Analyst</h1>
      <p class="text-slate-500 dark:text-slate-400">Ask anything about players, clubs, tactics, records, and football history.</p>
    </div>

    <div class="modern-surface overflow-hidden" style="height: 640px; display: flex; flex-direction: column;">
      <div class="bg-gradient-to-r from-slate-900 via-gray-900 to-gray-800 p-4 flex items-center gap-3">
        <div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-xl">🤖</div>
        <div>
          <div class="font-bold text-white">StrikerForge Lab Assistant</div>
          <div class="text-gray-100 text-xs flex items-center gap-1">
            <span class="w-2 h-2 bg-gray-400 rounded-full inline-block animate-pulse"></span> Online · AI powered
          </div>
        </div>
        <div class="ml-auto flex items-center gap-3">
          <span class="text-white/70 text-xs hidden sm:block">${AppState.chat.history.length > 0 ? AppState.chat.history.filter(h=>h.role==='user').length + ' messages' : 'Ask anything!'}</span>
          <button onclick="clearChat()" class="text-white/70 hover:text-white text-sm transition-colors flex items-center gap-1">
            <i class="fas fa-trash text-xs"></i>
            <span class="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      <div id="chat-messages" class="flex-1 overflow-y-auto p-4 space-y-4 chat-area">
        ${AppState.chat.history.length === 0 ? `
          <div class="flex flex-col items-center justify-center h-full text-center py-4 px-4">
            <div class="text-5xl mb-3 float-anim">⚽</div>
            <h3 class="font-bold text-slate-100 text-lg mb-1">Your Football AI Expert</h3>
            <p class="text-slate-400 text-sm max-w-sm mb-5">Get detailed answers on football history, player careers, tactical systems, and records.</p>
            <div class="grid sm:grid-cols-2 gap-2 max-w-2xl w-full">
              ${suggestions.map(s => `
                <button onclick="askSuggestion('${s.replace(/'/g, "\\'")}')"
                  class="text-left p-2.5 rounded-xl bg-gray-500/10 border border-gray-500/25 hover:bg-gray-500/15 transition-all text-xs text-gray-300 leading-tight">
                  <i class="fas fa-comment-dots mr-1 opacity-60"></i>${s}
                </button>
              `).join('')}
            </div>
          </div>
        ` : chatHTML}
        ${AppState.chat.loading ? `
          <div class="chat-message flex justify-start gap-2">
            <div class="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-500 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0">🤖</div>
            <div class="px-4 py-3 bg-white dark:bg-slate-900 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm">
              <div class="typing-indicator flex gap-1 items-center h-5">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="p-4 border-t border-slate-200 dark:border-slate-800">
        <div class="flex gap-2">
          <input type="text" id="chat-input" placeholder="Ask about any player, team, manager..."
            class="flex-1 px-4 py-3 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none search-input transition-all text-sm"
            onkeypress="if(event.key==='Enter') sendChatMessage()">
          <button onclick="sendChatMessage()" id="chat-send-btn"
            class="btn-primary px-5 py-3 text-white rounded-2xl font-bold flex items-center gap-2 transition-all ${AppState.chat.loading ? 'opacity-50 cursor-not-allowed' : ''}">
            <i class="fas fa-paper-plane"></i>
          </button>
        </div>
        <p class="text-slate-400 text-xs mt-2 text-center">Powered by StrikerForge Lab AI</p>
      </div>
    </div>

    <div class="mt-6 grid sm:grid-cols-3 gap-4">
      ${[
        { title: 'Player Quiz', icon: '⭐', desc: 'AI-generated player questions', action: "navigate('players')" },
        { title: 'League Quiz', icon: '🏆', desc: 'Test league knowledge', action: "navigate('leagues')" },
        { title: 'Champions League', icon: '🌍', desc: 'Europe\'s elite quiz', action: "navigate('quiz-setup',{quizCategory:'champions_league',quizName:'Champions League'})" },
      ].map(c => `
        <button onclick="${c.action}" class="modern-surface card-hover p-4 flex items-center gap-3 text-left">
          <div class="text-3xl">${c.icon}</div>
          <div>
            <div class="font-bold text-slate-100 text-sm">${c.title}</div>
            <div class="text-slate-400 text-xs">${c.desc}</div>
          </div>
          <i class="fas fa-arrow-right text-slate-400 ml-auto"></i>
        </button>
      `).join('')}
    </div>
  </div>
  ${renderFooter()}`;
}
function askSuggestion(text) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = text;
    sendChatMessage();
  }
}

function clearChat() {
  AppState.chat.history = [];
  render();
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input?.value?.trim();
  if (!message || AppState.chat.loading) return;

  input.value = '';
  AppState.chat.history.push({ role: 'user', content: message });
  AppState.chat.loading = true;

  // Re-render to show user message + typing indicator
  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) {
    chatMessages.innerHTML = AppState.chat.history.map(renderChatMessage).join('') + `
      <div class="chat-message flex justify-start gap-2">
        <div class="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-500 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0">🤖</div>
        <div class="px-4 py-3 bg-white dark:bg-slate-900 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm">
          <div class="typing-indicator flex gap-1 items-center h-5">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Disable send button
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await sendAiChatMessage({ message });
    AppState.chat.history.push({
      role: 'assistant',
      content: res.reply,
      parsed: res.parsed || null,
      txHash: res.txHash || null
    });
  } catch (e) {
    AppState.chat.history.push({
      role: 'assistant',
      content: "## ⚠️ Connection Error\n\nI couldn't reach the server. Please check your connection and try again!"
    });
  }

  AppState.chat.loading = false;

  // Re-enable send button
  if (sendBtn) sendBtn.disabled = false;

  // Update chat display with markdown rendered messages
  if (chatMessages) {
    chatMessages.innerHTML = AppState.chat.history.map(renderChatMessage).join('');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// ---- ABOUT PAGE ----
function renderAbout() {
  return `
  ${renderNav('about')}
  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-10 page-enter">
    <div class="text-center mb-10">
      <div class="text-6xl mb-4 float-anim">⚽</div>
      <h1 class="text-4xl font-black text-slate-900 dark:text-white mb-2">About StrikerForge Lab</h1>
      <p class="text-slate-500 dark:text-slate-400">A focused football knowledge platform</p>
    </div>
    <div class="modern-surface p-8 space-y-6">
      <p class="text-slate-200">StrikerForge Lab combines league quizzes, player-specific challenges, and an AI football assistant in one streamlined experience.</p>
      <div class="grid sm:grid-cols-3 gap-3">
        ${[
          { title: 'League Mode', desc: 'Compete across major domestic and continental competitions.' },
          { title: 'Player Mode', desc: 'Generate custom quiz sets for any football player.' },
          { title: 'AI Analyst', desc: 'Get rich answers on tactics, history, and records.' },
        ].map(item => `
          <div class="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
            <p class="font-bold text-slate-100 mb-1">${item.title}</p>
            <p class="text-xs text-slate-400">${item.desc}</p>
          </div>
        `).join('')}
      </div>
    </div>
  </div>
  ${renderFooter()}`;
}

// ---- FOOTER ----
function renderFooter() {
  return `
  <footer class="mt-12 border-t border-slate-200 dark:border-slate-800 py-8 text-center text-slate-500 dark:text-slate-500 text-sm">
    <div class="flex justify-center gap-4 mt-3 text-xs">
      <button onclick="navigate('home')" class="hover:text-gray-500 transition-colors">Home</button>
      <button onclick="navigate('leagues')" class="hover:text-gray-500 transition-colors">Leagues</button>
      <button onclick="navigate('players')" class="hover:text-gray-500 transition-colors">Players</button>
      <button onclick="navigate('ai')" class="hover:text-gray-500 transition-colors">AI Chat</button>
    </div>
  </footer>`;
}

// ---- EVENT LISTENERS ----
function attachEventListeners() {
  // Start timer if on quiz page
  if (AppState.currentPage === 'quiz' && AppState.quiz.started) {
    setTimeout(() => startTimer(), 100);
  }

  // Handle preset difficulty on quiz setup
  if (AppState.currentPage === 'quiz-setup' && AppState.selectedDifficulty) {
    selectedDiff = AppState.selectedDifficulty;
  }
}

function exposeGlobalHandlers() {
  const globalHandlers = {
    navigate,
    cycleTheme,
    selectDifficulty,
    selectCount,
    startQuiz,
    jumpToQuestion,
    goToPrevQuestion,
    goToNextQuestion,
    skipQuestion,
    confirmQuit,
    retryQuiz,
    searchPlayer,
    selectPlayer,
    startPlayerQuiz,
    askSuggestion,
    clearChat,
    sendChatMessage
  }

  Object.assign(window, globalHandlers)
}

function clearGlobalHandlers() {
  const keys = [
    'navigate',
    'cycleTheme',
    'selectDifficulty',
    'selectCount',
    'startQuiz',
    'jumpToQuestion',
    'goToPrevQuestion',
    'goToNextQuestion',
    'skipQuestion',
    'confirmQuit',
    'retryQuiz',
    'searchPlayer',
    'selectPlayer',
    'startPlayerQuiz',
    'askSuggestion',
    'clearChat',
    'sendChatMessage'
  ] as const

  for (const key of keys) {
    delete window[key]
  }
}

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
const onSystemThemeChange = () => {
  if (ThemeManager.get() === 'system') {
    ThemeManager.apply('system')
  }
}

// ---- INIT ----
function init() {
  if (window.__strikerlabBooted) return;
  window.__strikerlabBooted = true;
  exposeGlobalHandlers()

  ThemeManager.init();

  // Listen for system theme changes
  systemThemeQuery.addEventListener('change', onSystemThemeChange)

  render();
}

function dispose() {
  clearInterval(quizTimer)
  systemThemeQuery.removeEventListener('change', onSystemThemeChange)
  clearGlobalHandlers()
  window.__strikerlabBooted = false

  const root = document.getElementById('striker-root')
  if (root) {
    root.innerHTML = ''
  }
}

export function mountStrikerLegacyApp() {
  init()
  return dispose
}
