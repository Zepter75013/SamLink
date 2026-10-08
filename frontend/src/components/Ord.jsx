// « 12ème » / « 12e » → « 12<sup>e</sup> », avec un « e » qui reste en minuscule
// même dans les titres en capitales (sinon « 12E »).
export function ord(text) {
  if (typeof text !== 'string') return text
  const re = /12(?:ème|e)(?![\p{L}])/gu
  const out = []
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<span key={m.index}>12<sup className="ord">e</sup></span>)
    last = m.index + m[0].length
  }
  if (out.length === 0) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}
