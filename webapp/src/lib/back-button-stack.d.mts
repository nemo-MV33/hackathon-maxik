export class BackButtonStack {
  constructor(button: { onClick: (callback: () => void) => void; offClick: (callback: () => void) => void; show: () => void; hide: () => void });
  add(callback: () => void): () => void;
}
