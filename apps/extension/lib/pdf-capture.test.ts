import { beforeAll, describe, expect, it, vi } from 'vitest';
import pdfScript from '../entrypoints/whatsapp-pdf.content';
import { PDF_MESSAGE } from './capture';

// Emulates WhatsApp Web handing a decrypted document to the browser for download.
describe('page-context PDF capture', () => {
  const posted: any[] = [];
  beforeAll(() => {
    if (!URL.createObjectURL) (URL as any).createObjectURL = () => `blob:https://web.whatsapp.com/${Math.random().toString(36).slice(2)}`;
    vi.spyOn(window, 'postMessage').mockImplementation(((msg: unknown) => posted.push(msg)) as any);
    (pdfScript as any).main();
  });

  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  };

  it('hands over a downloaded PDF as base64', async () => {
    download(new Blob(['%PDF-1.4 teste'], { type: 'application/pdf' }), 'Orcamento_4471.pdf');
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ source: PDF_MESSAGE, name: 'Orcamento_4471.pdf' });
    expect(atob(posted[0].data)).toBe('%PDF-1.4 teste');
  });

  it('ignores other downloads', async () => {
    download(new Blob(['imagem'], { type: 'image/jpeg' }), 'foto.jpg');
    download(new Blob(['audio'], { type: 'audio/ogg' }), 'audio.ogg');
    await new Promise((r) => setTimeout(r, 50));
    expect(posted).toHaveLength(1);
  });
});
