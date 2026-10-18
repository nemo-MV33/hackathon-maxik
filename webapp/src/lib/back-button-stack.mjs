// У MAX одна кнопка «Назад». Только верхний экран или открытая шторка
// получает нажатие; после закрытия возвращается предыдущий обработчик.
export class BackButtonStack {
  constructor(button) {
    this.button = button;
    this.handlers = [];
    this.handle = () => this.handlers.at(-1)?.();
  }
  add(callback) {
    if (!this.handlers.length) {
      this.button.onClick(this.handle);
      this.button.show();
    }
    this.handlers.push(callback);
    return () => {
      const index = this.handlers.indexOf(callback);
      if (index < 0) return;
      this.handlers.splice(index, 1);
      if (!this.handlers.length) {
        this.button.offClick(this.handle);
        this.button.hide();
      }
    };
  }
}
