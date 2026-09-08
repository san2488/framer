'use client';
/* oxlint-disable next/no-img-element -- user-selected blob URLs must remain local and cannot use an image optimizer */

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ImagePlus, LoaderCircle, Minus, Plus, Printer, RotateCw, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

type Layout = 'two' | 'three';
type PhotoState = { src: string | null; name: string; zoom: number; rotation: number; x: number; y: number; aspectRatio: number };
const makePhoto = (): PhotoState => ({ src: null, name: '', zoom: 1, rotation: 0, x: 0, y: 0, aspectRatio: 1 });
const slotLabels = ['Main photo', 'Photo two', 'Photo three'];

type WebModelContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => unknown;
  }, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

export default function Home() {
  const [layout, setLayout] = useState<Layout>('three');
  const [photos, setPhotos] = useState<PhotoState[]>([makePhoto(), makePhoto(), makePhoto()]);
  const [selected, setSelected] = useState(0);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<{ index: number; message: string } | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const dragState = useRef<{ index: number; startX: number; startY: number; slotW: number; slotH: number; photoX: number; photoY: number; currentX: number; currentY: number; maxX: number; maxY: number } | null>(null);
  const visibleCount = layout === 'two' ? 2 : 3;
  const active = photos[selected];

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'set_collage_layout',
      title: 'Set collage layout',
      description: 'Switch the visible 4 × 6 collage between its two-photo and three-photo layouts.',
      inputSchema: {
        type: 'object',
        properties: { photoCount: { type: 'integer', enum: [2, 3] } },
        required: ['photoCount'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const photoCount = (input as { photoCount?: unknown })?.photoCount;
        if (photoCount !== 2 && photoCount !== 3) throw new Error('photoCount must be 2 or 3');
        setLayout(photoCount === 2 ? 'two' : 'three');
        setSelected((value) => Math.min(value, photoCount - 1));
        return { photoCount, layout: photoCount === 2 ? 'equal halves' : 'one large and two small' };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const updatePhoto = (index: number, update: Partial<PhotoState>) => {
    setPhotos((current) => current.map((photo, i) => (i === index ? { ...photo, ...update } : photo)));
  };

  const getPhotoGeometry = (index: number, photo: PhotoState) => {
    const slotRatio = index === 0 || layout === 'two' ? 4 / 3 : 2 / 3;
    const width = photo.aspectRatio > slotRatio ? (photo.aspectRatio / slotRatio) * 100 : 100;
    const height = photo.aspectRatio > slotRatio ? 100 : (slotRatio / photo.aspectRatio) * 100;
    const quarterTurn = Math.abs(photo.rotation / 90) % 2 === 1;
    const baseEffectiveWidth = quarterTurn ? height / slotRatio : width;
    const baseEffectiveHeight = quarterTurn ? width * slotRatio : height;
    // Let the user zoom out as far as needed to see the entire rotated photo.
    // At that scale, any difference between the photo and slot aspect ratios is
    // intentionally shown as white space instead of being cropped away.
    const minZoom = Math.min(1, 100 / baseEffectiveWidth, 100 / baseEffectiveHeight);
    const effectiveWidth = baseEffectiveWidth * photo.zoom;
    const effectiveHeight = baseEffectiveHeight * photo.zoom;
    return {
      width,
      height,
      minZoom,
      maxX: Math.max(0, (effectiveWidth - 100) / 2),
      maxY: Math.max(0, (effectiveHeight - 100) / 2),
    };
  };

  const updateZoom = (index: number, zoom: number) => {
    const photo = photos[index];
    const minimum = getPhotoGeometry(index, { ...photo, zoom: 1 }).minZoom;
    const nextZoom = Math.max(minimum, zoom);
    const limits = getPhotoGeometry(index, { ...photo, zoom: nextZoom });
    updatePhoto(index, {
      zoom: nextZoom,
      x: Math.max(-limits.maxX, Math.min(limits.maxX, photo.x)),
      y: Math.max(-limits.maxY, Math.min(limits.maxY, photo.y)),
    });
  };

  const rotatePhoto = (index: number) => {
    const photo = photos[index];
    const rotation = (photo.rotation + 90) % 360;
    const rotatedMinimum = getPhotoGeometry(index, { ...photo, rotation, zoom: 1 }).minZoom;
    const zoom = Math.max(rotatedMinimum, photo.zoom);
    const limits = getPhotoGeometry(index, { ...photo, rotation, zoom });
    updatePhoto(index, {
      rotation,
      zoom,
      x: Math.max(-limits.maxX, Math.min(limits.maxX, photo.x)),
      y: Math.max(-limits.maxY, Math.min(limits.maxY, photo.y)),
    });
  };

  const uploadPhoto = async (index: number, file?: File) => {
    if (!file) return;
    const mayBeHeic = /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
    if (!file.type.startsWith('image/') && !mayBeHeic) return;
    setUploadError(null);
    setSelected(index);
    try {
      let usableBlob: Blob = file;
      if (mayBeHeic) {
        setProcessing(index);
        const { heicTo, isHeic } = await import('heic-to/next');
        if (!(await isHeic(file))) throw new Error('This file does not appear to be a valid HEIC photo.');
        usableBlob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.94 });
      }
      const previewUrl = URL.createObjectURL(usableBlob);
      const previewImage = await loadImage(previewUrl);
      const previous = photos[index].src;
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
      updatePhoto(index, { src: previewUrl, name: file.name, zoom: 1, rotation: 0, x: 0, y: 0, aspectRatio: previewImage.naturalWidth / previewImage.naturalHeight });
    } catch {
      setUploadError({ index, message: 'Could not open this HEIC photo. Try exporting it as JPEG first.' });
    } finally {
      setProcessing(null);
    }
  };

  const removePhoto = (index: number) => {
    const current = photos[index].src;
    if (current?.startsWith('blob:')) URL.revokeObjectURL(current);
    updatePhoto(index, makePhoto());
    if (uploadError?.index === index) setUploadError(null);
  };

  const handlePointerDown = (event: React.PointerEvent, index: number) => {
    if (!photos[index].src) { inputs.current[index]?.click(); return; }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const limits = getPhotoGeometry(index, photos[index]);
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(index);
    setDraggingIndex(index);
    dragState.current = {
      index,
      startX: event.clientX,
      startY: event.clientY,
      slotW: bounds.width,
      slotH: bounds.height,
      photoX: photos[index].x,
      photoY: photos[index].y,
      currentX: photos[index].x,
      currentY: photos[index].y,
      maxX: limits.maxX,
      maxY: limits.maxY,
    };
  };

  const handlePointerMove = (event: React.PointerEvent, index: number) => {
    const drag = dragState.current;
    if (!drag || drag.index !== index) return;
    event.preventDefault();
    const dx = ((event.clientX - drag.startX) / drag.slotW) * 100;
    const dy = ((event.clientY - drag.startY) / drag.slotH) * 100;
    drag.currentX = Math.max(-drag.maxX, Math.min(drag.maxX, drag.photoX + dx));
    drag.currentY = Math.max(-drag.maxY, Math.min(drag.maxY, drag.photoY + dy));
    const image = event.currentTarget.querySelector('img');
    if (image) { image.style.left = `${50 + drag.currentX}%`; image.style.top = `${50 + drag.currentY}%`; }
  };

  const handlePointerEnd = (event: React.PointerEvent) => {
    const drag = dragState.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag) updatePhoto(drag.index, { x: drag.currentX, y: drag.currentY });
    dragState.current = null;
    setDraggingIndex(null);
  };

  const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
  });

  const downloadCollage = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 1800;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    const gutter = Math.round(300 / 25.4); // 1 mm at 300 DPI
    const halfHeight = (1800 - gutter) / 2;
    const halfWidth = (1200 - gutter) / 2;
    const slots = layout === 'two'
      ? [[0, 0, 1200, halfHeight], [0, halfHeight + gutter, 1200, halfHeight]]
      : [[0, 0, 1200, halfHeight], [0, halfHeight + gutter, halfWidth, halfHeight], [halfWidth + gutter, halfHeight + gutter, halfWidth, halfHeight]];

    await Promise.all(slots.map(async ([x, y, width, height], index) => {
      const photo = photos[index];
      if (!photo.src) return;
      const image = await loadImage(photo.src);
      const radians = (photo.rotation * Math.PI) / 180;
      const coverScale = Math.max(width / image.width, height / image.height) * photo.zoom;
      context.save(); context.beginPath(); context.rect(x, y, width, height); context.clip();
      context.translate(x + width / 2 + (photo.x / 100) * width, y + height / 2 + (photo.y / 100) * height);
      context.rotate(radians);
      context.drawImage(image, (-image.width * coverScale) / 2, (-image.height * coverScale) / 2, image.width * coverScale, image.height * coverScale);
      context.restore();
    }));
    const link = document.createElement('a');
    link.download = `framer-${layout}-photo-collage.png`;
    link.href = canvas.toDataURL('image/png'); link.click();
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border bg-card px-5 md:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground"><span className="font-serif text-lg italic">F</span></div>
          <div><h1 className="font-serif text-xl leading-none tracking-tight">Framer</h1><p className="mt-1 text-xs text-muted-foreground">4 × 6 collage maker</p></div>
        </div>
        <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex"><Check className="size-4 text-accent-foreground" /> Photos stay on your device</div>
      </header>

      <div className="editor-shell">
        <aside className="controls-panel">
          <section>
            <p className="section-kicker">01 / Layout</p><h2 className="section-title">Choose your frame</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button aria-label="Use the two-photo equal-halves layout" className={`layout-option ${layout === 'two' ? 'is-active' : ''}`} onClick={() => { setLayout('two'); setSelected((v) => Math.min(v, 1)); }} type="button">
                <span className="layout-mini two"><i /><i /></span><span><strong>Two photos</strong><small>Equal halves</small></span>
              </button>
              <button aria-label="Use the three-photo layout" className={`layout-option ${layout === 'three' ? 'is-active' : ''}`} onClick={() => setLayout('three')} type="button">
                <span className="layout-mini three"><i /><i /><i /></span><span><strong>Three photos</strong><small>One large, two small</small></span>
              </button>
            </div>
          </section>

          <section className="panel-section">
            <div className="flex items-end justify-between gap-4"><div><p className="section-kicker">02 / Photos</p><h2 className="section-title">Add your moments</h2></div><span className="text-xs text-muted-foreground">{photos.slice(0, visibleCount).filter((p) => p.src).length}/{visibleCount}</span></div>
            <div className="mt-4 space-y-2">
              {photos.slice(0, visibleCount).map((photo, index) => (
                <div key={index}>
                  <input ref={(element) => { inputs.current[index] = element; }} className="sr-only" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" onChange={(event) => { void uploadPhoto(index, event.target.files?.[0]); event.currentTarget.value = ''; }} />
                  <button disabled={processing === index} type="button" className={`photo-row ${selected === index ? 'is-active' : ''}`} onClick={() => photo.src ? setSelected(index) : inputs.current[index]?.click()}>
                    <span className="photo-thumb">{photo.src ? <img src={photo.src} alt="" /> : <ImagePlus className="size-4" />}</span>
                    <span className="min-w-0 flex-1 text-left"><strong>{slotLabels[index]}</strong><small>{processing === index ? 'Converting HEIC…' : photo.name || 'Choose JPEG, PNG, or HEIC'}</small></span>{processing === index ? <LoaderCircle className="size-4 animate-spin text-accent-foreground" /> : <Upload className="size-4 text-muted-foreground" />}
                  </button>
                  {uploadError?.index === index && <p className="upload-error" role="alert">{uploadError.message}</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <p className="section-kicker">03 / Adjust</p>
            <div className="flex items-center justify-between"><h2 className="section-title">{slotLabels[selected]}</h2>{active.src && <span className="text-xs text-muted-foreground">Drag photo to move</span>}</div>
            <div className={`adjustments ${!active.src ? 'is-disabled' : ''}`}>
              <div className="control-line"><label htmlFor="zoom">Zoom <span>{active.zoom.toFixed(2)}×</span></label><Minus className="size-3.5" />
                <Slider id="zoom" min={getPhotoGeometry(selected, active).minZoom} max={3} step={0.05} value={[active.zoom]} onValueChange={(value) => updateZoom(selected, Array.isArray(value) ? value[0] : Number(value))} disabled={!active.src} />
                <Plus className="size-3.5" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="h-10 justify-center" disabled={!active.src} onClick={() => rotatePhoto(selected)}><RotateCw /> Rotate 90°</Button>
                <Button variant="outline" className="h-10 justify-center" disabled={!active.src} onClick={() => updatePhoto(selected, { zoom: 1, rotation: 0, x: 0, y: 0 })}>Reset position</Button>
                <Button variant="outline" className="h-10 justify-center" disabled={!active.src || processing === selected} onClick={() => inputs.current[selected]?.click()}><Upload /> Replace photo</Button>
                <Button variant="destructive" className="h-10 justify-center" disabled={!active.src || processing === selected} onClick={() => removePhoto(selected)}><Trash2 /> Remove photo</Button>
              </div>
            </div>
          </section>

          <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-5">
            <Button variant="outline" className="h-11" onClick={() => window.print()}><Printer /> Print 4 × 6</Button>
            <Button className="h-11" onClick={downloadCollage}><ArrowDownToLine /> Download PNG</Button>
          </div>
        </aside>

        <section className="preview-stage" aria-label="Collage preview">
          <div className="preview-heading"><div><p className="section-kicker">Live preview</p><h2 className="font-serif text-2xl tracking-tight">Your 4 × 6 print</h2></div><span className="size-note">Portrait · 1 mm cut gutters</span></div>
          <div className={`print-sheet collage-grid ${layout}`}>
            {photos.slice(0, visibleCount).map((photo, index) => {
              const geometry = getPhotoGeometry(index, photo);
              return <button type="button" className={`photo-slot slot-${index + 1} ${photo.src ? 'has-photo' : ''} ${selected === index ? 'is-selected' : ''} ${draggingIndex === index ? 'is-dragging' : ''}`} key={index}
                onPointerDown={(event) => handlePointerDown(event, index)} onPointerMove={(event) => handlePointerMove(event, index)} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}
                aria-label={`${slotLabels[index]}${photo.src ? ', drag to reposition' : ', add photo'}`}>
                {photo.src ? <img src={photo.src} alt={slotLabels[index]} draggable={false} style={{ width: `${geometry.width}%`, height: `${geometry.height}%`, left: `${50 + photo.x}%`, top: `${50 + photo.y}%`, transform: `translate(-50%, -50%) rotate(${photo.rotation}deg) scale(${photo.zoom})` }} /> :
                  <span className="empty-slot"><span className="empty-slot-icon"><Plus className="size-5" /></span><strong>Add photo {index + 1}</strong><small>{index === 0 || layout === 'two' ? 'Landscape area' : 'Portrait area'}</small></span>}
                <span className="slot-number">{index + 1}</span>
              </button>;
            })}
          </div>
          <p className="preview-tip">Select a frame, then drag the photo to find the perfect crop.</p>
        </section>
      </div>
    </main>
  );
}
