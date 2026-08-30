import { api, unwrap, type Schemas } from "@/shared/api";

export type Source = Schemas["SourceOut"];
export type SourcesOut = Schemas["SourcesOut"];
export type Fx = Schemas["FxOut"];
export type SourceCreate = Schemas["SourceCreateIn"];

export const fetchSources = (): Promise<SourcesOut> => unwrap(api.GET("/api/v1/sources"));
export const patchSource = (id: string, enabled: boolean): Promise<Source> =>
  unwrap(api.PATCH("/api/v1/sources/{source_id}", { params: { path: { source_id: id } }, body: { enabled } }));
export const createSource = (body: SourceCreate): Promise<Source> => unwrap(api.POST("/api/v1/sources", { body }));
