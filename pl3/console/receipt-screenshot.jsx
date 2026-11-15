import React, { useState } from 'react';
import { createWorker } from 'tesseract.js';
import { readBankReceipt } from './receipt-screenshot.js';

const assetHost = 'https://cdn.jsdelivr.net/npm';

export function ReceiptScreenshot({ onApply }) {
  const [images, setImages] = useState([]);
  const [result, setResult] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState('');

  function select(files) {
    if (!files.length || working) return;
    setResult(null);
    setDetails('');
    if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10_000_000)) {
      setMessage('請選擇 10 MB 內的 PNG、JPEG 或 WebP 截圖。');
      return;
    }
    if (images.length + files.length > 2) {
      setMessage('請先清除截圖，再貼上同一筆的入帳通知和交易明細。');
      return;
    }
    setImages([...images, ...files]);
    setMessage('');
  }

  async function recognize() {
    setWorking(true);
    setResult(null);
    setMessage('正在辨識截圖…');
    let worker;
    try {
      worker = await createWorker(['chi_tra', 'eng'], 1, {
        workerPath: assetHost + '/tesseract.js@6.0.1/dist/worker.min.js',
        corePath: assetHost + '/tesseract.js-core@6.1.2',
        errorHandler: () => {},
      });
      const texts = [];
      for (const image of images) {
        const { data } = await worker.recognize(image);
        texts.push(data.text);
      }
      const draft = readBankReceipt(texts);
      setDetails(draft?.details || '');
      setResult(draft);
      setMessage(draft ? '請對照原圖確認辨識結果。' : '無法完整辨識入帳通知。請換一張清楚的截圖，或直接手動填寫。');
    } catch {
      setMessage('辨識無法完成。請重試，或直接手動填寫。');
    } finally {
      try {
        await worker?.terminate();
      } finally {
        setWorking(false);
      }
    }
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('已複製' + label);
    } catch {
      setMessage('無法存取剪貼簿，請選取文字手動複製。');
    }
  }

  const evidence = result ? result.evidence + details.trim() : '';
  return <section className="note">
    <label htmlFor="receipt-image-paste"><b>貼上銀行入帳通知截圖</b></label>
    <textarea id="receipt-image-paste" rows={2} readOnly value={images.length ? `已加入 ${images.length} 張截圖` : ''}
      placeholder="點這裡，按 Ctrl + V 或 ⌘ + V 貼上截圖"
      onPaste={event => {
        const files = Array.from(event.clipboardData.files).filter(item => item.type.startsWith('image/'));
        if (files.length) {
          event.preventDefault();
          select(files);
        }
      }} />
    <label>或選擇同一筆的入帳通知與交易明細（最多兩張） <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={working}
      onChange={event => { select(Array.from(event.target.files)); event.target.value = ''; }} /></label>
    <button type="button" className="secondary" disabled={!images.length || working} onClick={recognize}>生成核帳資料</button>
    {images.length > 0 && <button type="button" className="quiet" disabled={working} onClick={() => {
      setImages([]);
      setResult(null);
      setDetails('');
      setMessage('');
    }}>清除截圖</button>}
    <p role="status">{message}</p>
    {result && <div>
      <p>{result.received_at} · NT${result.amount_twd}</p>
      <label>PL 內部核帳識別碼<input readOnly value={result.transaction_id} /></label>
      <button type="button" className="secondary" onClick={() => copy(result.transaction_id, '識別碼')}>複製識別碼</button>
      <label>實際入帳核對證據<textarea readOnly value={evidence} rows={3} /></label>
      <label>銀行交易明細核對結果<input value={details} onChange={event => setDetails(event.target.value)}
        placeholder="例如：已核對跨行轉帳及轉出帳號末五碼" /></label>
      <div className="actions">
        <button type="button" className="secondary" disabled={!details.trim()} onClick={() => copy(evidence, '核對證據')}>複製核對證據</button>
        <button type="button" className="secondary" disabled={!details.trim()} onClick={() => {
          const { received_at, amount_twd, transaction_id } = result;
          onApply({ received_at, amount_twd, transaction_id, evidence });
          setMessage('已帶入表單，請核對款項分配後再送出。');
        }}>帶入表單</button>
      </div>
    </div>}
  </section>;
}
