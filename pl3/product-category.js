// Controlled display categories for PL3, including existing legacy formats.
// Never infer product category from a title except for the already-identified
// Margaret issue: existing live stock must not silently change category.
export const PRODUCT_CATEGORIES=Object.freeze([
 '其他周邊','書籍／雜誌','卡片／紙類','壓克力周邊','徽章／吊飾',
 '絨毛玩偶','模型／公仔','服飾／飾品','音樂／影音','生活雜貨',
 '小卡','壓克力立牌','徽章','鑰匙圈','貼紙','耳機','收納包吊飾',
 '按鍵吊飾','掛繩','黏毛滾輪','帽T','韓國周邊'
]);
export function inferProductCategory(product){
 const explicit=String(product?.product_type||product?.productType||'').trim();
 if(explicit)return explicit;
 const title=String(product?.name||product?.title||'');
 if(/マーガレット/.test(title)&&/2026.*第\s*23\s*號/.test(title))return '書籍／雜誌';
 return '其他周邊';
}
