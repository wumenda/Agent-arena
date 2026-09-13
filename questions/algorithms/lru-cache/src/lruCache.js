// 固定容量的 LRU 缓存：容量满时 set 淘汰最久未使用的键；get/has 命中也算一次使用。
// set 支持链式调用（返回 this），容量非法时抛 RangeError。
export class LRUCache {
  #cap;
  #map = new Map();

  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("capacity 必须 >= 1 的整数");
    }
    this.#cap = capacity;
  }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    return this.#map.get(key);
  }

  has(key) {
    return this.#map.has(key);
  }

  set(key, value) {
    if (this.#map.has(key)) {
      this.#map.set(key, value);
      return this;
    }
    if (this.#map.size >= this.#cap) {
      const oldest = this.#map.keys().next().value;
      this.#map.delete(oldest);
    }
    this.#map.set(key, value);
    return this;
  }
}
