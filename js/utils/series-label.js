/**
 * @param {import('../storage/library-db.js').SeriesInfo} series
 * @returns {string}
 */
export function seriesLabel(series) {
  return series.position != null ? `${series.name} · Book ${series.position}` : series.name;
}
