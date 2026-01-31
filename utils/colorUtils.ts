
/**
 * A large palette of distinct colors for clients, excluding greys.
 */
export const CLIENT_PALETTE = [
  '#E6194B', '#3CB44B', '#FFE119', '#4363D8', '#F58231', '#911EB4', '#46F0F0', '#F032E6',
  '#BCF60C', '#FABEBE', '#008080', '#E6BEFF', '#9A6324', '#FFFAC8', '#800000', '#AAFFC3',
  '#808000', '#FFD8B1', '#000075', '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
  '#D4A5A5', '#FF7F50', '#6495ED', '#483D8B', '#00CED1', '#9400D3', '#FF1493', '#00BFFF',
  '#ADFF2F', '#FF69B4', '#CD5C5C', '#4B0082', '#F0E68C', '#7CFC00', '#FFFAC8',
  '#ADD8E6', '#F08080', '#E0FFFF', '#FAFAD2', '#90EE90', '#FFB6C1', '#FFA07A', '#20B2AA',
  '#87CEFA', '#B0C4DE', '#FFFFE0', '#00FF00', '#32CD32', '#FAF0E6', '#FF00FF',
  '#FF4500', '#DA70D6', '#EEE8AA', '#98FB98', '#AFEEEE', '#DB7093', '#FFEFD5', '#FFDAB9',
  '#CD853F', '#FFC0CB', '#DDA0DD', '#B0E0E6', '#FF0000', '#BC8F8F', '#4169E1', '#8B4513',
  '#FA8072', '#F4A460', '#2E8B57', '#A0522D', '#87CEEB', '#6A5ACD', '#00FF7F', '#4682B4',
  '#D2B48C', '#008080', '#D8BFD8', '#FF6347', '#40E0D0', '#EE82EE', '#F5DEB3', '#FFFF00',
  '#9ACD32', '#FF4500', '#2E8B57', '#4682B4', '#D2691E', '#FF8C00', '#0000CD'
];

/**
 * Returns a stable color from the palette for a given ID.
 */
export const getClientColor = (id: string): string => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % CLIENT_PALETTE.length;
  return CLIENT_PALETTE[index];
};

/**
 * Determines whether black or white text should be used on a given background color for better contrast.
 */
export const getContrastText = (hexcolor: string): string => {
  if (!hexcolor) return '#1E293B';
  const hex = hexcolor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 128) ? '#1E293B' : '#FFFFFF';
};
