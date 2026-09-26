export type DamageLevel = "Verde" | "Amarillo" | "Rojo";

export type AuctionStatus = "ACTIVE" | "CLOSED" | "DESERTED";

export type Vehicle = {
  id: string;
  ownerUid: string;
  title: string;
  year: number;
  articleType: string;
  brand: string;
  model: string;
  engine: string;
  transmission: string;
  fuel: string;
  drivetrain: string;
  cylinders: number;
  damage: DamageLevel;
  photos: string[];
  basePrice: number;
  currentBid: number;
  bidCount: number;
  startsAt: string;
  endsAt: string;
  startsAtMs?: number;
  endsAtMs?: number;
  status: AuctionStatus;
};

export type AuctionUser = {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  idToken?: string;
  isDemo?: boolean;
};

export type VehicleDraft = Omit<
  Vehicle,
  "id" | "ownerUid" | "title" | "photos" | "currentBid" | "bidCount" | "status"
> & {
  photos: File[];
};
