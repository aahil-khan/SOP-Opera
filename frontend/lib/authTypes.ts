export type ActorKind = "user" | "worker";

export interface Actor {
  id: string;
  kind: ActorKind;
  name: string;
  role: string;
  owned_zones: string[];
}

export interface RosterEntry {
  id: string;
  kind: ActorKind;
  name: string;
  role: string;
  owned_zones: string[];
}

