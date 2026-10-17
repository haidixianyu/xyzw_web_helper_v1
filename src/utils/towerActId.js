const FRIDAY_DAY = 5;
const DAYS_PER_WEEK = 7;

const getCycleFriday = (date) => {
  const cycleDate = new Date(date);
  const diff = (cycleDate.getDay() - FRIDAY_DAY + DAYS_PER_WEEK) % DAYS_PER_WEEK;

  cycleDate.setHours(0, 0, 0, 0);
  cycleDate.setDate(cycleDate.getDate() - diff);

  return cycleDate;
};

// 玄武赐福活动ID前缀（当天日期 YYMMDD，如 "260919"）
export const getXuanwuActBase = (date = new Date()) => {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}${month}${day}`;
};

export const getTowerActId = (date = new Date()) => {
  const cycleFriday = getCycleFriday(date);
  const year = String(cycleFriday.getFullYear()).slice(-2);
  const month = String(cycleFriday.getMonth() + 1).padStart(2, "0");
  const day = String(cycleFriday.getDate()).padStart(2, "0");

  return Number(`${year}${month}${day}1`);
};

// 生成本周活动的候选 actId 列表
// 活动后缀随周期递增（历史为 1、2，当前周期为 3），无法硬编码，
// 需逐个用 towers_getinfo 探测，第一个返回有效数据的即为本周期 actId
export const getTowerActCandidates = (date = new Date()) => {
  const cycleFriday = getCycleFriday(date);
  const year = String(cycleFriday.getFullYear()).slice(-2);
  const month = String(cycleFriday.getMonth() + 1).padStart(2, "0");
  const day = String(cycleFriday.getDate()).padStart(2, "0");
  const base = `${year}${month}${day}`;

  return Array.from({ length: 6 }, (_, i) => Number(`${base}${i + 1}`));
};
