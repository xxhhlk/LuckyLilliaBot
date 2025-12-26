import React, { useState } from 'react'
import { X } from 'lucide-react'

// 可用的表情 ID 列表（基于 public/face 目录）
const FACE_IDS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19,
  20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  41, 42, 43, 46, 49, 53, 56, 59, 60, 63, 64, 66, 67, 74, 75, 76, 77, 78, 79,
  85, 86, 89, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
  110, 111, 112, 114, 116, 118, 119, 120, 121, 123, 124, 125, 129, 137, 144, 146, 147,
  169, 171, 172, 173, 174, 175, 176, 177, 178, 179, 181, 182, 183, 185, 187,
  201, 212, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 277,
  281, 282, 283, 284, 285, 286, 287, 289, 293, 294, 295, 297, 298, 299,
  300, 302, 303, 305, 306, 307, 311, 312, 314, 317, 318, 319, 320, 323, 324, 325, 326,
  332, 333, 334, 336, 337, 338, 339, 341, 342, 343, 344, 345, 346, 347, 349,
  350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 392, 393, 394, 395
]

interface EmojiPickerProps {
  onSelect: (faceId: number) => void
  onClose: () => void
  position?: { x: number; y: number }
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose, position }) => {
  const [loadedFaces, setLoadedFaces] = useState<Set<number>>(new Set())

  return (
    <div 
      className="absolute bottom-full left-0 mb-2 bg-theme-card border border-theme-divider rounded-xl shadow-xl z-50"
      style={position ? { left: position.x, bottom: position.y } : undefined}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-theme-divider">
        <span className="text-sm font-medium text-theme">表情</span>
        <button onClick={onClose} className="p-1 hover:bg-theme-item rounded transition-colors">
          <X size={14} className="text-theme-hint" />
        </button>
      </div>
      <div className="p-2 max-h-[280px] overflow-y-auto w-[320px]">
        <div className="grid grid-cols-8 gap-1">
          {FACE_IDS.map(faceId => (
            <button
              key={faceId}
              onClick={() => onSelect(faceId)}
              className="w-8 h-8 flex items-center justify-center hover:bg-theme-item rounded transition-colors"
              title={`表情 ${faceId}`}
            >
              <img
                src={`/face/${faceId}.png`}
                alt={`表情${faceId}`}
                className={`w-6 h-6 transition-opacity ${loadedFaces.has(faceId) ? 'opacity-100' : 'opacity-0'}`}
                onLoad={() => setLoadedFaces(prev => new Set(prev).add(faceId))}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default EmojiPicker
