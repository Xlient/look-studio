export interface PoseFilter<T> {
  filter(sample: T, tMs: number): T;
}
