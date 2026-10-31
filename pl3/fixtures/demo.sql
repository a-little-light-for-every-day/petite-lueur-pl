-- SYNTHETIC staging fixture only. NEVER real customers, real payment details or official product images.
INSERT INTO campaigns(id, campaign_code, title, lifecycle_status, public_approved, closes_at_utc, updated_at_utc)
VALUES
 ('demo-open','DEMO-OPEN','[DEMO] 商品測試團','open',1,'2099-12-31T23:59:59.000Z','2026-11-01T00:00:00.000Z'),
 ('demo-closed','DEMO-CLOSED','[DEMO] 已結單','closed',1,'2099-12-31T23:59:59.000Z','2026-11-01T00:00:00.000Z'),
 ('demo-expired','DEMO-EXPIRED','[DEMO] 截止時間已過','open',1,'2020-01-01T00:00:00.000Z','2026-11-01T00:00:00.000Z'),
 ('demo-hidden','DEMO-HIDDEN','[DEMO] 未審核團次','open',0,'2099-12-31T23:59:59.000Z','2026-11-01T00:00:00.000Z');

INSERT INTO products(id,campaign_id,merchant_sku,variant_key,title,variant_label,price_twd,lifecycle_status,public_approved,sort_order,updated_at_utc)
VALUES
 ('demo-product-visible','demo-open','DEMO-001','pink','[DEMO] 彩色髮夾','粉色',100,'active',1,1,'2026-11-01T00:00:00.000Z'),
 ('demo-product-draft','demo-open','DEMO-002','blue','[DEMO] 未核准商品','藍色',100,'active',0,2,'2026-11-01T00:00:00.000Z'),
 ('demo-product-closed','demo-closed','DEMO-003','single','[DEMO] 已結單商品','單件',100,'active',1,1,'2026-11-01T00:00:00.000Z'),
 ('demo-product-expired','demo-expired','DEMO-004','single','[DEMO] 過期商品','單件',100,'active',1,1,'2026-11-01T00:00:00.000Z'),
 ('demo-product-hidden-campaign','demo-hidden','DEMO-005','single','[DEMO] 未審核團次商品','單件',100,'active',1,1,'2026-11-01T00:00:00.000Z'),
 ('demo-product-sold-out','demo-open','DEMO-006','single','[DEMO] 售完商品','單件',100,'sold_out',1,3,'2026-11-01T00:00:00.000Z');
