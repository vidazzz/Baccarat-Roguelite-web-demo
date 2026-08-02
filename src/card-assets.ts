import ace from "./assets/cards/1.png";
import two from "./assets/cards/2.png";
import three from "./assets/cards/3.png";
import four from "./assets/cards/4.png";
import five from "./assets/cards/5.png";
import six from "./assets/cards/6.png";
import seven from "./assets/cards/7.png";
import eight from "./assets/cards/8.png";
import nine from "./assets/cards/9.png";
import ten from "./assets/cards/10.png";
import jack from "./assets/cards/11.png";
import queen from "./assets/cards/12.png";
import king from "./assets/cards/13.png";

export const cardFaceAssets = [ace, two, three, four, five, six, seven, eight, nine, ten, jack, queen, king] as const;

export function cardFaceAsset(rank: number): string {
  const index = Math.max(0, Math.min(cardFaceAssets.length - 1, Math.floor(rank) - 1));
  return cardFaceAssets[index]!;
}
