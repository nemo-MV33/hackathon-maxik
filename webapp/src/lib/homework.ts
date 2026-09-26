// Старые ссылки с ДЗ остаются читаемыми после переноса хранения на сервер.
export type SharedHomework = {
  groupId: number;
  date: string;
  lessonNumber: number;
  subgroup: 1 | 2 | null;
  text: string;
};

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};

const pipe = async (bytes: Uint8Array, stream: DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());

export const decodeHomework = async (payload: string): Promise<SharedHomework | null> => {
  const match = payload.match(/^hw1([zj])([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  try {
    let bytes = fromBase64Url(match[2]);
    if (match[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    const [groupId, date, lessonNumber, subgroup, text] = JSON.parse(new TextDecoder().decode(bytes));
    if (!Number.isInteger(groupId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(lessonNumber)) return null;
    if (typeof text !== 'string' || !text.trim()) return null;
    return { groupId, date, lessonNumber, subgroup: subgroup === 1 || subgroup === 2 ? subgroup : null, text: text.slice(0, 1000) };
  } catch {
    return null;
  }
};
