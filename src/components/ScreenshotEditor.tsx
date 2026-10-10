import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KImage, Arrow, Rect, Text, Line } from 'react-konva';
import Konva from 'konva';
import {
  ArrowRight, Crop, MousePointer2, Minus, Pencil, Plus,
  Redo2, Square, Type, Undo2, X, Check,
} from 'lucide-react';

// ── types ──

type Tool = 'select' | 'crop' | 'arrow' | 'rect' | 'text' | 'freehand';

interface ArrowShape { type: 'arrow'; points: number[]; color: string; id: string }
interface RectShape { type: 'rect'; x: number; y: number; w: number; h: number; color: string; id: string }
interface TextShape { type: 'text'; x: number; y: number; text: string; color: string; fontSize: number; id: string }
interface FreehandShape { type: 'freehand'; points: number[]; color: string; id: string }
type Shape = ArrowShape | RectShape | TextShape | FreehandShape;

interface CropRegion { x: number; y: number; w: number; h: number }

const COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#ffffff', '#000000'];

let _shapeId = 0;
function nextId() { return `s${++_shapeId}`; }

// ── component ──

export default function ScreenshotEditor({
  imageDataUrl,
  onDone,
  onCancel,
}: {
  imageDataUrl: string;
  onDone: (editedDataUrl: string) => void;
  onCancel: () => void;
}) {
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [undoStack, setUndoStack] = useState<Shape[][]>([]);
  const [redoStack, setRedoStack] = useState<Shape[][]>([]);

  // crop state
  const [cropRegion, setCropRegion] = useState<CropRegion | null>(null);
  const [cropping, setCropping] = useState(false);

  // drawing state
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const currentShapeRef = useRef<Shape | null>(null);

  // text input state
  const [textInput, setTextInput] = useState<{ x: number; y: number; stageX: number; stageY: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);

  // image
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 });
  const [scale, setScale] = useState(1);

  // load image
  useEffect(() => {
    const image = new window.Image();
    image.onload = () => {
      setImg(image);
      setImgSize({ w: image.naturalWidth, h: image.naturalHeight });
    };
    image.src = imageDataUrl;
  }, [imageDataUrl]);

  // fit stage to container
  useEffect(() => {
    if (!containerRef.current || !imgSize.w) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const s = Math.min(cw / imgSize.w, ch / imgSize.h, 1);
    setScale(s);
    setStageSize({ w: imgSize.w * s, h: imgSize.h * s });
  }, [imgSize]);

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo(); }
      if (e.key === 'Escape') {
        if (textInput) { setTextInput(null); setTextValue(''); }
        else if (cropRegion) { setCropRegion(null); setCropping(false); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const pushUndo = useCallback((prev: Shape[]) => {
    setUndoStack((s) => [...s.slice(-30), prev]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setRedoStack((r) => [...r, shapes]);
      setShapes(prev);
      return stack.slice(0, -1);
    });
  }, [shapes]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((u) => [...u, shapes]);
      setShapes(next);
      return stack.slice(0, -1);
    });
  }, [shapes]);

  // ── stage to image coords ──
  const toImg = useCallback((sx: number, sy: number) => ({
    x: sx / scale, y: sy / scale,
  }), [scale]);

  // ── pointer handlers ──
  const onPointerDown = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (textInput) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const p = toImg(pos.x, pos.y);

    if (tool === 'crop') {
      setCropRegion({ x: p.x, y: p.y, w: 0, h: 0 });
      setCropping(true);
      return;
    }

    if (tool === 'text') {
      setTextInput({ x: p.x, y: p.y, stageX: pos.x, stageY: pos.y });
      setTextValue('');
      setTimeout(() => textInputRef.current?.focus(), 50);
      return;
    }

    if (tool === 'arrow' || tool === 'rect' || tool === 'freehand') {
      setDrawing(true);
      setDrawStart(p);
      if (tool === 'arrow') {
        const s: ArrowShape = { type: 'arrow', points: [p.x, p.y, p.x, p.y], color, id: nextId() };
        currentShapeRef.current = s;
      } else if (tool === 'rect') {
        const s: RectShape = { type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color, id: nextId() };
        currentShapeRef.current = s;
      } else {
        const s: FreehandShape = { type: 'freehand', points: [p.x, p.y], color, id: nextId() };
        currentShapeRef.current = s;
      }
    }
  }, [tool, color, scale, textInput, toImg]);

  const onPointerMove = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const p = toImg(pos.x, pos.y);

    if (tool === 'crop' && cropping && cropRegion) {
      setCropRegion({ ...cropRegion, w: p.x - cropRegion.x, h: p.y - cropRegion.y });
      return;
    }

    if (!drawing || !drawStart || !currentShapeRef.current) return;
    const cur = currentShapeRef.current;
    if (cur.type === 'arrow') {
      currentShapeRef.current = { ...cur, points: [drawStart.x, drawStart.y, p.x, p.y] };
    } else if (cur.type === 'rect') {
      currentShapeRef.current = { ...cur, w: p.x - drawStart.x, h: p.y - drawStart.y };
    } else if (cur.type === 'freehand') {
      currentShapeRef.current = { ...cur, points: [...cur.points, p.x, p.y] };
    }
    // force re-render for live preview
    setShapes((s) => [...s]);
  }, [tool, drawing, drawStart, cropping, cropRegion, toImg]);

  const onPointerUp = useCallback(() => {
    if (tool === 'crop' && cropping) {
      setCropping(false);
      return;
    }
    if (!drawing || !currentShapeRef.current) return;
    const s = currentShapeRef.current;
    // skip tiny shapes
    let valid = true;
    if (s.type === 'arrow') {
      const [x1, y1, x2, y2] = s.points;
      valid = Math.hypot(x2 - x1, y2 - y1) > 5;
    } else if (s.type === 'rect') {
      valid = Math.abs(s.w) > 3 && Math.abs(s.h) > 3;
    } else if (s.type === 'freehand') {
      valid = s.points.length > 4;
    }
    if (valid) {
      pushUndo(shapes);
      setShapes((prev) => [...prev, s]);
    }
    currentShapeRef.current = null;
    setDrawing(false);
    setDrawStart(null);
  }, [tool, drawing, shapes, cropping, pushUndo]);

  const commitText = useCallback(() => {
    if (!textInput || !textValue.trim()) {
      setTextInput(null);
      setTextValue('');
      return;
    }
    pushUndo(shapes);
    setShapes((prev) => [...prev, {
      type: 'text', x: textInput.x, y: textInput.y, text: textValue.trim(),
      color, fontSize: 18, id: nextId(),
    }]);
    setTextInput(null);
    setTextValue('');
  }, [textInput, textValue, color, shapes, pushUndo]);

  // ── crop apply ──
  const applyCrop = useCallback(() => {
    if (!cropRegion || !img) return;
    const x = Math.min(cropRegion.x, cropRegion.x + cropRegion.w);
    const y = Math.min(cropRegion.y, cropRegion.y + cropRegion.h);
    const w = Math.abs(cropRegion.w);
    const h = Math.abs(cropRegion.h);
    if (w < 10 || h < 10) { setCropRegion(null); return; }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

    const newImg = new window.Image();
    newImg.onload = () => {
      pushUndo(shapes);
      setImg(newImg);
      setImgSize({ w, h });
      setShapes([]);
      setCropRegion(null);
      setTool('select');
    };
    newImg.src = canvas.toDataURL('image/png');
  }, [cropRegion, img, shapes, pushUndo]);

  // ── export final image ──
  const exportImage = useCallback(() => {
    if (!img) return;
    // render at full resolution
    const offscreen = new Konva.Stage({
      container: document.createElement('div'),
      width: imgSize.w,
      height: imgSize.h,
    });
    const layer = new Konva.Layer();
    offscreen.add(layer);

    const kImg = new Konva.Image({ image: img, x: 0, y: 0, width: imgSize.w, height: imgSize.h });
    layer.add(kImg);

    for (const s of shapes) {
      if (s.type === 'arrow') {
        layer.add(new Konva.Arrow({ points: s.points, stroke: s.color, fill: s.color, strokeWidth: 3, pointerLength: 12, pointerWidth: 10 }));
      } else if (s.type === 'rect') {
        layer.add(new Konva.Rect({ x: s.x, y: s.y, width: s.w, height: s.h, stroke: s.color, strokeWidth: 3 }));
      } else if (s.type === 'text') {
        layer.add(new Konva.Text({ x: s.x, y: s.y, text: s.text, fill: s.color, fontSize: s.fontSize, fontFamily: 'sans-serif' }));
      } else if (s.type === 'freehand') {
        layer.add(new Konva.Line({ points: s.points, stroke: s.color, strokeWidth: 3, lineCap: 'round', lineJoin: 'round' }));
      }
    }
    layer.draw();
    const dataUrl = offscreen.toDataURL({ pixelRatio: 1, mimeType: 'image/png' });
    offscreen.destroy();
    onDone(dataUrl);
  }, [img, imgSize, shapes, onDone]);

  // ── all shapes to render (including current drawing) ──
  const renderShapes = useMemo(() => {
    const all = [...shapes];
    if (currentShapeRef.current && drawing) all.push(currentShapeRef.current);
    return all;
  }, [shapes, drawing]);

  const toolBtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => { setTool(t); setCropRegion(null); }}
      className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] transition-colors ${
        tool === t ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-300 hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
      {/* toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-700">
        <div className="flex items-center gap-1">
          {toolBtn('select', <MousePointer2 size={16} />, '選択')}
          {toolBtn('crop', <Crop size={16} />, '裁切')}
          {toolBtn('arrow', <ArrowRight size={16} />, '矢印')}
          {toolBtn('rect', <Square size={16} />, '矩形')}
          {toolBtn('text', <Type size={16} />, 'テキスト')}
          {toolBtn('freehand', <Pencil size={16} />, 'ペン')}

          <div className="w-px h-8 bg-neutral-700 mx-2" />

          {/* colors */}
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${
                  color === c ? 'border-white scale-125' : 'border-neutral-600'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <div className="w-px h-8 bg-neutral-700 mx-2" />

          <button type="button" onClick={undo} disabled={undoStack.length === 0}
            className="p-1.5 rounded-lg text-neutral-300 hover:text-white disabled:text-neutral-600">
            <Undo2 size={16} />
          </button>
          <button type="button" onClick={redo} disabled={redoStack.length === 0}
            className="p-1.5 rounded-lg text-neutral-300 hover:text-white disabled:text-neutral-600">
            <Redo2 size={16} />
          </button>

          {cropRegion && !cropping && Math.abs(cropRegion.w) > 10 && (
            <>
              <div className="w-px h-8 bg-neutral-700 mx-2" />
              <button type="button" onClick={applyCrop}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500">
                <Check size={14} />
                裁切を適用
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-neutral-400 hover:text-white text-sm">
            キャンセル
          </button>
          <button type="button" onClick={exportImage}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-500">
            <Check size={14} />
            完了
          </button>
        </div>
      </div>

      {/* canvas area */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden p-4">
        {img && (
          <div className="relative">
            <Stage
              ref={stageRef}
              width={stageSize.w}
              height={stageSize.h}
              scaleX={scale}
              scaleY={scale}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
            >
              <Layer>
                <KImage image={img} x={0} y={0} width={imgSize.w} height={imgSize.h} />

                {renderShapes.map((s) => {
                  if (s.type === 'arrow') {
                    return <Arrow key={s.id} points={s.points} stroke={s.color} fill={s.color} strokeWidth={3 / scale} pointerLength={12 / scale} pointerWidth={10 / scale} />;
                  }
                  if (s.type === 'rect') {
                    return <Rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} stroke={s.color} strokeWidth={3 / scale} />;
                  }
                  if (s.type === 'text') {
                    return <Text key={s.id} x={s.x} y={s.y} text={s.text} fill={s.color} fontSize={s.fontSize} fontFamily="sans-serif" />;
                  }
                  if (s.type === 'freehand') {
                    return <Line key={s.id} points={s.points} stroke={s.color} strokeWidth={3 / scale} lineCap="round" lineJoin="round" />;
                  }
                  return null;
                })}

                {/* crop overlay */}
                {cropRegion && (
                  <>
                    <Rect x={0} y={0} width={imgSize.w} height={imgSize.h} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect
                      x={Math.min(cropRegion.x, cropRegion.x + cropRegion.w)}
                      y={Math.min(cropRegion.y, cropRegion.y + cropRegion.h)}
                      width={Math.abs(cropRegion.w)}
                      height={Math.abs(cropRegion.h)}
                      fill="transparent"
                      stroke="#3b82f6"
                      strokeWidth={2 / scale}
                      globalCompositeOperation="destination-out"
                    />
                    <Rect
                      x={Math.min(cropRegion.x, cropRegion.x + cropRegion.w)}
                      y={Math.min(cropRegion.y, cropRegion.y + cropRegion.h)}
                      width={Math.abs(cropRegion.w)}
                      height={Math.abs(cropRegion.h)}
                      stroke="#3b82f6"
                      strokeWidth={2 / scale}
                      dash={[6 / scale, 4 / scale]}
                      listening={false}
                    />
                  </>
                )}
              </Layer>
            </Stage>

            {/* floating text input */}
            {textInput && (
              <input
                ref={textInputRef}
                type="text"
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitText(); }}
                onBlur={commitText}
                className="absolute bg-transparent border-b-2 text-lg outline-none"
                style={{
                  left: textInput.stageX,
                  top: textInput.stageY,
                  color,
                  borderColor: color,
                  minWidth: 100,
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
