export class Signaler {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = null;
    this.handlers = {};

    this.ws.onopen = () => console.log("🔗 Signaler connected");
    this.ws.onclose = () => console.log("🚪 Signaler disconnected");

    this.ws.onmessage = ({ data }) => {
      const { from, type, payload, id } = JSON.parse(data);

      if (type === "welcome") {
        // Save your own ID
        this.id = id;
        // And dispatch to any 'welcome' handlers:
        (this.handlers.welcome || []).forEach(fn => fn(from, id));
      } else {
        (this.handlers[type] || []).forEach(fn => fn(from, payload));
      }
    };
  }

  send(to, type, payload) {
    this.ws.send(JSON.stringify({ to, type, payload }));
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
  }
}
