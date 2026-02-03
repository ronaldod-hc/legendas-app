
import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import type { Subtitle } from '../types';
import { formatTime } from '../utils/formatTime';

interface TimelineProps {
  duration: number;
  currentTime: number;
  subtitles: Subtitle[];
  activeSubtitleId: number | null;
  zoomLevel: number;
  onTimeUpdate: (time: number) => void;
  onSubtitleChange: (updatedSubtitle: Subtitle) => void;
  onSubtitleSelect: (id: number | null) => void;
}

const Timeline: React.FC<TimelineProps> = ({
  duration,
  currentTime,
  subtitles,
  activeSubtitleId,
  zoomLevel,
  onTimeUpdate,
  onSubtitleChange,
  onSubtitleSelect,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{
    id: number;
    type: 'start' | 'end' | 'move';
    initialX: number;
    initialStartTime: number;
    initialEndTime: number;
  } | null>(null);

  // The width is strictly controlled by the zoom level. 
  // 1x = 100% of container (Fit to Screen).
  const currentWidthPercent = zoomLevel * 100;

  // Calculate conversion rates based on the *current actual width* of the timeline div
  const pixelsToSeconds = useCallback((pixels: number) => {
    if (!timelineRef.current || duration === 0) return 0;
    return (pixels / timelineRef.current.offsetWidth) * duration;
  }, [duration]);

  const secondsToPixels = useCallback((seconds: number) => {
    if (!timelineRef.current || duration === 0) return 0;
    return (seconds / duration) * timelineRef.current.offsetWidth;
  }, [duration]);

  // Auto-scroll logic to keep playhead in view, only when playing and zoomed in
  useEffect(() => {
    if (scrollContainerRef.current && timelineRef.current && duration > 0 && zoomLevel > 1) {
      const container = scrollContainerRef.current;
      const timelineWidth = timelineRef.current.offsetWidth;
      const playheadPos = (currentTime / duration) * timelineWidth;
      
      const scrollLeft = container.scrollLeft;
      const clientWidth = container.clientWidth;
      
      // Scroll if playhead is getting close to edges (10% buffer)
      const buffer = clientWidth * 0.1;

      if (playheadPos > scrollLeft + clientWidth - buffer) {
        container.scrollTo({ left: playheadPos - clientWidth * 0.5, behavior: 'auto' });
      } else if (playheadPos < scrollLeft + buffer) {
        container.scrollTo({ left: Math.max(0, playheadPos - clientWidth * 0.5), behavior: 'auto' });
      }
    } else if (scrollContainerRef.current && zoomLevel === 1) {
        // Force reset scroll when fully zoomed out
        scrollContainerRef.current.scrollTo({ left: 0 });
    }
  }, [currentTime, duration, zoomLevel]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    onTimeUpdate(pixelsToSeconds(clickX));
  };
  
  const handleMouseDown = (e: React.MouseEvent, id: number, type: 'start' | 'end' | 'move') => {
    e.stopPropagation();
    const subtitle = subtitles.find(s => s.id === id);
    if (!subtitle) return;

    onSubtitleSelect(id);

    setDragging({
      id,
      type,
      initialX: e.clientX,
      initialStartTime: subtitle.startTime,
      initialEndTime: subtitle.endTime,
    });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !timelineRef.current) return;
    
    const deltaX = e.clientX - dragging.initialX;
    const deltaTime = pixelsToSeconds(deltaX);
    
    const subtitle = subtitles.find(s => s.id === dragging.id);
    if (!subtitle) return;

    const otherSubtitles = subtitles.filter(s => s.id !== dragging.id);

    let newStartTime = subtitle.startTime;
    let newEndTime = subtitle.endTime;

    if (dragging.type === 'move') {
      newStartTime = Math.max(0, dragging.initialStartTime + deltaTime);
      newEndTime = newStartTime + (dragging.initialEndTime - dragging.initialStartTime);
      if (newEndTime > duration) {
        newEndTime = duration;
        newStartTime = newEndTime - (dragging.initialEndTime - dragging.initialStartTime);
      }
    } else if (dragging.type === 'start') {
      newStartTime = Math.min(
        Math.max(0, dragging.initialStartTime + deltaTime),
        subtitle.endTime - 0.1
      );
    } else { // 'end'
      newEndTime = Math.max(
        Math.min(duration, dragging.initialEndTime + deltaTime),
        subtitle.startTime + 0.1
      );
    }

    // Collision detection
    const isOverlapping = otherSubtitles.some(other =>
      (newStartTime < other.endTime && newEndTime > other.startTime)
    );

    if (!isOverlapping) {
      onSubtitleChange({ ...subtitle, startTime: newStartTime, endTime: newEndTime });
    }
  }, [dragging, subtitles, duration, onSubtitleChange, pixelsToSeconds]);
  
  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  React.useEffect(() => {
    if (dragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  const sortedSubtitles = useMemo(() => [...subtitles].sort((a, b) => a.startTime - b.startTime), [subtitles]);

  // Calculate markers dynamically based on "pixels per second"
  // This ensures we don't clutter the timeline when zoomed out on long videos
  const markers = useMemo(() => {
    if (duration <= 0 || !timelineRef.current) return null;

    // Estimate pixels per second. 
    // If the container isn't rendered yet, we approximate based on window width,
    // but usually the ref is available on re-renders.
    const width = timelineRef.current.offsetWidth || (window.innerWidth * zoomLevel);
    const pixelsPerSecond = width / duration;

    // Determine interval based on density
    let interval = 1; // default 1s
    
    if (pixelsPerSecond < 0.5) interval = 60; // extremely dense (e.g. 1 hour video at 1x) -> every 1 min
    else if (pixelsPerSecond < 2) interval = 30; // very dense -> every 30s
    else if (pixelsPerSecond < 10) interval = 10; // dense -> every 10s
    else if (pixelsPerSecond < 40) interval = 5; // moderate -> every 5s
    else interval = 1; // spacious -> every 1s

    const markerElements = [];
    for (let i = interval; i < duration; i += interval) {
      markerElements.push(i);
    }

    return markerElements.map(time => (
      <div
        key={`marker-${time}`}
        className="absolute top-1/2 h-full w-px bg-brand-gray-700 z-10 pointer-events-none"
        style={{ left: `${(time / duration) * 100}%`, transform: 'translateY(-50%)' }}
      >
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-brand-gray-300 whitespace-nowrap select-none">
          {formatTime(time).split('.')[0]}
        </span>
      </div>
    ));
  }, [duration, zoomLevel, currentWidthPercent]); // Re-calculate when zoom or duration changes

  return (
    <div className="w-full h-48 bg-gray-900 flex flex-col border-t border-brand-gray-700">
       <div className="px-4 py-2 text-xs flex justify-between text-gray-400 bg-brand-gray-800 shadow-inner z-20 relative shrink-0">
        <span>{formatTime(currentTime)}</span>
        <span>Total: {formatTime(duration)}</span>
      </div>
      
      {/* Scrollable Area */}
      <div 
        ref={scrollContainerRef} 
        className="flex-grow overflow-x-auto overflow-y-hidden custom-scrollbar relative"
      >
        <div 
            ref={timelineRef} 
            className="h-full relative cursor-pointer" 
            style={{ width: `${currentWidthPercent}%`, minWidth: '100%' }}
            onClick={handleTimelineClick}
        >
            {/* Main timeline bar */}
            <div className="w-full h-1 bg-gray-600 absolute top-1/2 -translate-y-1/2"></div>
            
            {/* Time markers */}
            {markers}
            
            {/* Playhead */}
            <div 
            className="w-0.5 h-full bg-brand-accent absolute top-0 z-20 pointer-events-none"
            style={{ left: `${(currentTime / duration) * 100}%` }}
            >
             <div className="w-3 h-3 bg-brand-accent rounded-full absolute -top-1 -left-1 shadow-md"></div>
             <div className="w-px h-screen bg-brand-accent/20 absolute top-0 left-1/2 pointer-events-none"></div>
            </div>

            {/* Subtitles layer */}
            <div className="w-full h-12 absolute top-1/2 -translate-y-1/2 mt-2 z-30">
            {sortedSubtitles.map((sub) => {
                const left = secondsToPixels(sub.startTime);
                const width = Math.max(2, secondsToPixels(sub.endTime - sub.startTime)); // Min width 2px
                const isActive = sub.id === activeSubtitleId;

                return (
                <div
                    key={sub.id}
                    className={`absolute h-full rounded-md flex items-center justify-center text-xs px-1 truncate cursor-move select-none transition-colors border ${isActive ? 'bg-brand-accent/90 border-brand-light ring-2 ring-brand-light/50 z-40' : 'bg-brand-accent/50 border-brand-accent/60 hover:bg-brand-accent/70 z-30'}`}
                    style={{ left, width }}
                    onClick={(e) => { e.stopPropagation(); onSubtitleSelect(sub.id); }}
                    onMouseDown={(e) => handleMouseDown(e, sub.id, 'move')}
                    title={sub.text}
                >
                    <div 
                    className="absolute left-0 top-0 w-3 h-full cursor-ew-resize hover:bg-white/20"
                    onMouseDown={(e) => handleMouseDown(e, sub.id, 'start')}
                    ></div>
                    <span className="pointer-events-none text-black font-bold overflow-hidden text-ellipsis whitespace-nowrap px-1">{sub.text}</span>
                    <div 
                    className="absolute right-0 top-0 w-3 h-full cursor-ew-resize hover:bg-white/20"
                    onMouseDown={(e) => handleMouseDown(e, sub.id, 'end')}
                    ></div>
                </div>
                );
            })}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Timeline;
