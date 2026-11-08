import { readExpression, type ReadResult } from './ExpressionReader';
import type { Expression } from './expressions';
import { nextPrompt, PROMPT_BY_ID, THEMES, type Prompt, type PromptTheme } from './prompts';
import { COMPLETED_PREFIX, ReflectionStore, type WritingSession } from './ReflectionStore';

type Reader = typeof readExpression;

/** First input locks a tab's question, including after erasure and reload.
 * Sending retires its stable ID and closes the writing session. */
export class ReflectionPanel {
  private note = document.createElement('section');
  private status = document.createElement('span');
  private controller?: AbortController;
  private timer = 0;
  private video: HTMLVideoElement | null = null;
  private expression: Expression | null = null;
  private assignedAt = -Infinity;
  private currentPrompt: Prompt | null = null;
  private previous = new Map<PromptTheme, string>();
  private textarea: HTMLTextAreaElement;
  private download: HTMLAnchorElement;
  private hint: HTMLElement;
  private notice: HTMLElement;
  private downloadURL = '';
  private observer: ResizeObserver;
  private disposed = false;
  private session: WritingSession | null = null;
  private store = new ReflectionStore();
  private sending = false;
  private exhausted = false;
  private offering?: Animation;
  private stage: HTMLElement | null;
  private stageLabel: string;

  constructor(private host: HTMLElement, private tint: (expression: Expression | null) => void, private reader: Reader = readExpression) {
    this.stage = host.querySelector('#mirror-stage');
    this.stageLabel = this.stage?.getAttribute('aria-label') ?? 'Mirror';
    this.note.className = 'reflection-note';
    this.note.hidden = true;
    this.note.setAttribute('aria-label', 'Reflection writing');
    const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
    this.note.innerHTML = `
      <span class="stationery-corner corner-nw" aria-hidden="true"></span><span class="stationery-corner corner-ne" aria-hidden="true"></span>
      <span class="stationery-corner corner-sw" aria-hidden="true"></span><span class="stationery-corner corner-se" aria-hidden="true"></span>
      <div class="stationery-content">
        <p id="writing-prompt" class="writing-prompt" aria-live="polite"></p>
        <label class="visually-hidden" for="reflection-words">Your reflection</label>
        <textarea id="reflection-words" rows="1" placeholder="A thought to follow…" maxlength="20000" aria-describedby="writing-prompt writing-privacy offering-hint" spellcheck="true"></textarea>
        <div class="offering-details" hidden>
          <p id="offering-hint">Touch the mirror to send <span aria-hidden="true">· ${shortcut}↵</span></p>
          <a id="download-reflection" hidden>Keep a copy</a>
        </div>
        <p class="reflection-notice" role="alert" hidden></p>
      </div>
      <span id="writing-privacy" class="visually-hidden">Your draft stays in this browser tab until sent or the tab closes. Sending clears the words and remembers only the completed question on this browser. Press Command or Control and Enter to send. Expression cues stay on this device.</span>`;
    this.status.id = 'expression-status'; this.status.className = 'visually-hidden'; this.status.setAttribute('role', 'status');
    host.append(this.note, this.status);
    this.textarea = this.note.querySelector('textarea')!;
    this.download = this.note.querySelector('a')!;
    this.hint = this.note.querySelector('.offering-details')!;
    this.notice = this.note.querySelector('.reflection-notice')!;
    this.textarea.addEventListener('focus', () => this.cancel());
    this.textarea.addEventListener('blur', () => this.schedule(1200));
    this.textarea.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
        event.preventDefault(); event.stopPropagation(); void this.send();
      }
    });
    this.textarea.addEventListener('input', () => {
      this.cancel();
      if (!this.session && this.currentPrompt && this.textarea.value.length) {
        this.session = { promptId: this.currentPrompt.id, expression: this.expression && this.currentPrompt.theme === THEMES[this.expression] ? this.expression : null, started: true, sent: false, draft: '' };
      }
      if (this.session) {
        this.session.draft = this.textarea.value;
        if (!this.store.saveSession(this.session)) this.showNotice('This browser cannot keep your draft across a reload. Keep this tab open or save a copy.');
        else this.showNotice('');
      }
      this.refreshWriting();
    });
    this.session = this.store.loadSession();
    if (this.session) {
      this.expression = this.session.expression;
      this.currentPrompt = PROMPT_BY_ID.get(this.session.promptId)!;
      if (this.session.sent || this.store.completed().has(this.session.promptId)) {
        this.session.sent = true; this.session.draft = ''; this.store.saveSession(this.session);
      } else {
        this.renderPrompt(); this.textarea.value = this.session.draft; this.refreshWriting();
      }
    }
    this.observer = new ResizeObserver(() => this.measure()); this.observer.observe(this.note);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('storage', this.onStorage);
  }

  get canSend() { return Boolean(this.session && !this.session.sent && !this.sending && this.textarea.value.trim()); }
  private locked() { return Boolean(this.session) || this.exhausted || document.activeElement === this.textarea; }
  private measure() {
    this.host.style.setProperty('--reflection-space', `${this.note.hidden ? 0 : this.note.offsetHeight + 36}px`);
    this.host.classList.toggle('has-reflection', !this.note.hidden);
  }
  private showNotice(text: string) { this.notice.textContent = text; this.notice.hidden = !text; }
  private refreshWriting() {
    if (this.downloadURL) URL.revokeObjectURL(this.downloadURL);
    this.downloadURL = '';
    const hasWords = Boolean(this.textarea.value.trim());
    this.download.hidden = !hasWords; this.hint.hidden = !hasWords;
    this.note.classList.toggle('has-writing', Boolean(this.session));
    if (hasWords && this.currentPrompt) {
      const date = new Date().toISOString().slice(0, 10);
      this.downloadURL = URL.createObjectURL(new Blob([`Reflection · ${date}\n\n${this.currentPrompt.text}\n\n${this.textarea.value}\n`], { type: 'text/plain;charset=utf-8' }));
      this.download.href = this.downloadURL; this.download.download = `reflection-${date}.txt`;
    } else this.download.removeAttribute('href');
    this.updateMirror(); this.measure();
  }
  private updateMirror() {
    if (!this.stage) return;
    this.stage.classList.toggle('receives-reflection', this.canSend);
    this.stage.setAttribute('aria-label', this.canSend ? 'Send your reflection into the mirror. Touch or press Enter.' : this.stageLabel);
    if (this.canSend) this.stage.setAttribute('role', 'button'); else this.stage.removeAttribute('role');
  }
  setVideo(video: HTMLVideoElement | null) {
    this.cancel(); this.video = video;
    if (video) { if (this.session && !this.session.sent) this.tint(this.expression); this.schedule(350); }
    else this.tint(null);
  }
  cameraUnavailable() {
    if (this.locked()) return;
    if (!this.currentPrompt) this.assign('open');
    if (!this.exhausted) this.status.textContent = 'An open question; camera access is unavailable.';
  }
  private renderPrompt() {
    if (!this.currentPrompt) return;
    this.note.querySelector('#writing-prompt')!.textContent = this.currentPrompt.text;
    this.note.hidden = false; this.measure();
  }
  private assign(theme: PromptTheme) {
    if (this.session) return;
    this.currentPrompt = nextPrompt(theme, this.store.completed(), this.previous.get(theme));
    if (!this.currentPrompt) {
      this.exhausted = true; this.note.hidden = true; this.measure(); this.tint(null);
      this.status.textContent = 'Every question in this collection has been reflected on. The mirror is yours.';
      return;
    }
    this.previous.set(this.currentPrompt.theme, this.currentPrompt.id);
    this.renderPrompt(); this.assignedAt = performance.now();
  }
  private schedule(delay = 14000) {
    clearTimeout(this.timer);
    if (this.disposed || !this.video || document.hidden || this.locked()) return;
    this.timer = window.setTimeout(() => void this.observe(), delay);
  }
  private cancel() { clearTimeout(this.timer); this.controller?.abort(); this.controller = undefined; }
  private onVisibility = () => { this.cancel(); if (!document.hidden) this.schedule(750); };
  private onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(COMPLETED_PREFIX) && !this.session && this.currentPrompt && this.store.completed().has(this.currentPrompt.id)) {
      this.cancel(); this.assign(this.currentPrompt.theme); this.tint(null); this.schedule();
    }
  };
  private apply(result: ReadResult) {
    if (this.session || this.exhausted) return;
    if (result.reading) {
      const expression = result.reading.expression;
      if (expression !== this.expression && (!this.currentPrompt || this.expression === null || performance.now() - this.assignedAt >= 12000)) {
        this.expression = expression; this.assign(THEMES[expression]);
      }
      if (this.exhausted) return;
      const matching = this.expression && this.currentPrompt?.theme === THEMES[this.expression];
      this.tint(matching ? this.expression : null);
      this.status.textContent = matching ? 'A philosophical question suggested by expression cues.' : 'An unread question from the collection.';
    } else {
      this.tint(null);
      if (!this.currentPrompt) this.assign('open');
      if (this.exhausted) return;
      this.status.textContent = result.reason === 'unavailable' ? 'Expression reading is unavailable; an open question is shown.'
        : result.reason === 'multiple' ? 'More than one face was visible; no expression was assigned.'
        : result.reason === 'no-face' ? 'A face wasn’t clearly visible; no expression was assigned.'
        : 'No consistent expression cue; the question remains open.';
    }
  }
  private async observe() {
    if (!this.video || this.locked() || document.hidden || this.disposed) return;
    const video = this.video, controller = new AbortController(); this.controller = controller;
    try {
      const result = await this.reader(video, controller.signal, () => {});
      if (controller.signal.aborted || this.video !== video || this.locked() || this.disposed || result.reason === 'cancelled') return;
      this.apply(result);
    } catch {
      if (!controller.signal.aborted && !this.locked() && !this.disposed) this.apply({ reading: null, reason: 'unavailable' });
    } finally {
      if (this.controller === controller) { this.controller = undefined; this.schedule(); }
    }
  }
  async send() {
    if (!this.canSend || !this.session) return;
    if (!this.store.complete(this.session)) {
      this.showNotice('The mirror cannot remember this question in this browser yet. Your words are still here; allow site storage, then try again.');
      return;
    }
    this.cancel(); this.sending = true; this.session.sent = true; this.session.draft = '';
    this.showNotice(''); this.updateMirror();
    const bounds = this.note.getBoundingClientRect(), canvas = this.stage?.querySelector('canvas');
    const target = canvas?.getBoundingClientRect();
    const x = target ? target.left + target.width / 2 - bounds.left - bounds.width / 2 : 0;
    const y = target ? target.top + Number(canvas!.dataset.glassCenterY || target.height / 3) - bounds.top - bounds.height / 2 : -70;
    if (this.note.contains(document.activeElement)) this.stage?.focus({ preventScroll: true });
    this.note.inert = true;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.offering = this.note.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
      { opacity: 1, transform: 'translate(0, 0) rotate(0deg) scale(1)', filter: 'blur(0)' },
      { opacity: .86, transform: `translate(${x * .55}px, ${y * .55}px) rotate(-4deg) scale(.62)`, filter: 'blur(0)', offset: .55 },
      { opacity: 0, transform: `translate(${x}px, ${y}px) rotate(3deg) scale(.045)`, filter: 'blur(3px)' },
    ], { duration: reduced ? 220 : 1250, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
    await this.offering.finished.catch(() => {});
    if (this.disposed) return;
    this.textarea.value = ''; this.note.hidden = true; this.sending = false;
    this.refreshWriting(); this.measure();
    this.status.textContent = 'Your words have been sent into the mirror. This question is complete; no more will appear in this session.';
  }
  dispose() {
    this.disposed = true; this.cancel(); this.offering?.cancel(); this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility); window.removeEventListener('storage', this.onStorage);
    if (this.downloadURL) URL.revokeObjectURL(this.downloadURL);
    this.note.remove(); this.status.remove(); this.host.classList.remove('has-reflection');
    this.host.style.removeProperty('--reflection-space');
  }
}
