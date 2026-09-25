// price = 该商品（整堆）的折扣前原价，服务端不下发，来自游戏内黑市截图 + 界面核对结果人工维护：
// 原价 = 现价 ÷ (折扣 / 10)，现价与折扣取黑市界面显示值（如 5 折 200 → 400）；未确认的物品留 0
export const blackMarketItemCatalog = [
  { itemId: 1001, label: "招募令", price: 2500, defaultDiscount: 10 },
  { itemId: 1011, label: "普通鱼竿", price: 1000, defaultDiscount: 10 },
  { itemId: 1012, label: "黄金鱼竿", price: 2500, defaultDiscount: 7 },
  { itemId: 1013, label: "珍珠", price: 0, defaultDiscount: 10 },
  { itemId: 1019, label: "盐锭", price: 0, defaultDiscount: 10 },
  { itemId: 1020, label: "皮肤币", price: 300, defaultDiscount: 10 },
  { itemId: 1021, label: "扫荡令", price: 200, defaultDiscount: 10 },
  { itemId: 1022, label: "白玉", price: 1600, defaultDiscount: 10 },
  { itemId: 1023, label: "彩玉", price: 500, defaultDiscount: 10 },
  { itemId: 2001, label: "木质宝箱", price: 0, defaultDiscount: 10 },
  { itemId: 2002, label: "青铜宝箱", price: 400, defaultDiscount: 10 },
  { itemId: 2003, label: "黄金宝箱", price: 375, defaultDiscount: 10 },
  { itemId: 2004, label: "铂金宝箱", price: 625, defaultDiscount: 10 },
  { itemId: 2005, label: "钻石宝箱", price: 0, defaultDiscount: 10 },
];

const blackMarketItemCatalogMap = new Map(
  blackMarketItemCatalog.map((item) => [item.itemId, item]),
);

export const getBlackMarketCatalogItem = (itemId) =>
  blackMarketItemCatalogMap.get(Number(itemId)) || null;

export const createBlackMarketPurchaseEntry = (itemId = null) => {
  const catalogItem = getBlackMarketCatalogItem(itemId);

  return {
    itemId: catalogItem?.itemId ?? itemId,
    price: catalogItem?.price ?? 0,
    discount: catalogItem?.defaultDiscount ?? 10,
    note: catalogItem?.label ?? "",
  };
};

// 默认采购清单：与游戏内黑市清单核对后的物品（原价已在上方价格表维护）
export const defaultBlackMarketPurchaseList = [
  createBlackMarketPurchaseEntry(1001),
  createBlackMarketPurchaseEntry(1011),
  createBlackMarketPurchaseEntry(1012),
  createBlackMarketPurchaseEntry(1022),
  createBlackMarketPurchaseEntry(1023),
  createBlackMarketPurchaseEntry(2002),
  createBlackMarketPurchaseEntry(2003),
  createBlackMarketPurchaseEntry(2004),
];

const toPositiveInteger = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const integer = Math.trunc(numeric);
  return integer > 0 ? integer : null;
};

const toNonNegativeInteger = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
};

const clampDiscount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 10;
  return Math.min(10, Math.max(1, Math.trunc(numeric)));
};

export const normalizeBlackMarketPurchaseList = (rawList = []) => {
  if (!Array.isArray(rawList)) return [];

  const merged = new Map();

  rawList.forEach((entry) => {
    const itemId = toPositiveInteger(entry?.itemId);
    if (!itemId) return;

    const catalogItem = getBlackMarketCatalogItem(itemId);

    merged.set(itemId, {
      itemId,
      // 原价服务端不下发：优先用本地已保存的值，未填写时回退到内置价格表
      price: toNonNegativeInteger(entry?.price) || catalogItem?.price || 0,
      discount: clampDiscount(
        entry?.discount ?? catalogItem?.defaultDiscount ?? 10,
      ),
      note:
        typeof entry?.note === "string" && entry.note.trim()
          ? entry.note.trim()
          : catalogItem?.label || "",
    });
  });

  return [...merged.values()].sort((left, right) => left.itemId - right.itemId);
};

// 折扣价 = ceil(折扣 / 10 * 原价)，与游戏内 GoodsListData.singlePrice 的算法一致
export const getBlackMarketDiscountedPrice = (entry) => {
  const price = toNonNegativeInteger(entry?.price);
  if (!price) return null;
  return Math.ceil((clampDiscount(entry?.discount) / 10) * price);
};

export const getBlackMarketTotalPrice = (rawList = []) =>
  normalizeBlackMarketPurchaseList(rawList).reduce((total, entry) => {
    const discounted = getBlackMarketDiscountedPrice(entry);
    return total + (discounted ?? 0);
  }, 0);

// 下发到服务器时只带 itemId 与折扣，原价仅本地记录
export const toStorePurchaseItemList = (rawList = []) =>
  normalizeBlackMarketPurchaseList(rawList).map(({ itemId, discount }) => ({
    itemId,
    discount,
  }));

export const compareBlackMarketPurchaseLists = (
  leftList = [],
  rightList = [],
) => {
  const left = JSON.stringify(toStorePurchaseItemList(leftList));
  const right = JSON.stringify(toStorePurchaseItemList(rightList));
  return left === right;
};
