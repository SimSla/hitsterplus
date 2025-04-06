type HitsterCard = {
  CardNumber: string;
  Spotify: string;
}
type HitsterGamesetData = {
  gameset_language: string;
  gameset_name: string;
  cards: HitsterCard[];
}
type HitsterGameset = {
  sku: string;
  gameset_data: HitsterGamesetData;
}
export type HitsterGamesetDatabase = {
  updated_on: number;
  gamesets: HitsterGameset[];
}