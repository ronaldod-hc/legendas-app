
export interface Subtitle {
  id: number;
  startTime: number;
  endTime: number;
  text: string;
}

export interface SubtitleStyle {
  color: string;
  fontSize: number;
  outlineColor: string;
  outlineWidth: number;
  positionY: number;
}
