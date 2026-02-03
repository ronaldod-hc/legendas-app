import React, { useState, useRef, useEffect } from 'react';

const PRESET_COLORS = ['#FFFFFF', '#000000', '#FF0000', '#FFFF00']; // Branco, Preto, Vermelho, Amarelo

interface ColorPickerProps {
  color: string;
  setColor: (color: string) => void;
  label: string;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ color, setColor, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(color);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(color);
  }, [color]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const validateAndSetColor = (value: string) => {
    if (/^#([0-9a-fA-F]{3}){1,2}$/.test(value)) {
      setColor(value.toUpperCase());
    } else {
      setInputValue(color); // Reset if invalid
    }
  };

  const handleInputBlur = () => {
    validateAndSetColor(inputValue);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
       validateAndSetColor(inputValue);
       setIsOpen(false);
       (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className="relative" ref={pickerRef}>
      <label className="block mb-1 text-brand-gray-300">{label}</label>
      <button
        type="button"
        className="w-8 h-8 border border-brand-gray-600 rounded-md"
        style={{ backgroundColor: color }}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Select color, current color is ${color}`}
      ></button>

      {isOpen && (
        <div className="absolute z-10 top-full mt-2 w-48 bg-brand-gray-700 rounded-md shadow-lg p-3 border border-brand-gray-600">
          <div className="w-full h-16 rounded-sm mb-2 border border-brand-gray-600/50" style={{ backgroundColor: color }}></div>
          
          <div className="grid grid-cols-4 gap-2 mb-3">
            {PRESET_COLORS.map(preset => (
              <button
                key={preset}
                type="button"
                className={`w-8 h-8 mx-auto rounded-md border-2 ${color.toUpperCase() === preset ? 'border-brand-accent' : 'border-transparent'} hover:border-brand-light`}
                style={{ backgroundColor: preset }}
                onClick={() => {
                  setColor(preset);
                  setIsOpen(false);
                }}
                aria-label={`Set color to ${preset}`}
              ></button>
            ))}
          </div>

          <input
            type="text"
            value={inputValue.toUpperCase()}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            className="w-full bg-brand-gray-800 text-brand-light p-1.5 rounded-md border border-brand-gray-600 text-center font-mono focus:ring-2 focus:ring-brand-accent focus:outline-none"
            placeholder="#000000"
          />
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
