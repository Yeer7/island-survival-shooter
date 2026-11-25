/** Keyboard + mouse state. Mouse look deltas are consumed once per frame. */
export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = false;
  private clicked = false;
  wheel = 0;
  locked = false;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    this.target.addEventListener('mousedown', (e) => {
      if (!this.locked || e.button !== 0) return;
      this.mouseDown = true;
      this.clicked = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
  }

  /** True once, on the frame the key went down. */
  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  consumeClick(): boolean {
    const c = this.clicked;
    this.clicked = false;
    return c;
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
