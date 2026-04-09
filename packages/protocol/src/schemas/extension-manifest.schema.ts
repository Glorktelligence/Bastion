// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Zod schemas for extension manifest validation.
 *
 * These schemas validate the structure of extension manifests loaded
 * from JSON files at relay startup.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Safety level
// ---------------------------------------------------------------------------

export const ExtensionSafetyLevelSchema = z.enum(['passthrough', 'task', 'admin', 'blocked']);

// ---------------------------------------------------------------------------
// Message type
// ---------------------------------------------------------------------------

export const ExtensionMessageTypeFieldSchema = z.object({
  type: z.string().min(1),
  required: z.boolean(),
  description: z.string(),
});

export const ExtensionMessageTypeAuditSchema = z.object({
  logEvent: z.string().min(1),
  logContent: z.boolean(),
});

export const ExtensionMessageTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  fields: z.record(z.string(), ExtensionMessageTypeFieldSchema).default({}),
  safety: ExtensionSafetyLevelSchema,
  adapterHint: z.string().optional(),
  compactable: z.boolean().optional(),
  audit: ExtensionMessageTypeAuditSchema,
});

// ---------------------------------------------------------------------------
// UI types
// ---------------------------------------------------------------------------

export const ExtensionUISizeSchema = z.object({
  minHeight: z.string().min(1),
  maxHeight: z.string().min(1),
});

export const ExtensionUIAuditSchema = z.object({
  logRender: z.boolean(),
  logInteractions: z.boolean(),
  logEvent: z.string(),
});

export const ExtensionUIComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  file: z.string().min(1),
  description: z.string(),
  function: z.string().min(1),
  messageTypes: z.array(z.string()),
  size: ExtensionUISizeSchema,
  placement: z.enum(['main', 'full-page', 'sidebar', 'settings-tab']),
  dangerous: z.boolean(),
  audit: ExtensionUIAuditSchema,
});

export const ExtensionUIPageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().min(1),
  components: z.array(ExtensionUIComponentSchema),
});

export const ExtensionUISchema = z.object({
  pages: z.array(ExtensionUIPageSchema),
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const ExtensionManifestSchema = z.object({
  namespace: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  author: z.string().default('unknown'),
  license: z.string().optional(),
  messageTypes: z.array(ExtensionMessageTypeSchema),
  dependencies: z.array(z.string()).optional(),
  ui: ExtensionUISchema.optional(),
  conversationRenderers: z
    .record(
      z.string(),
      z.object({
        html: z.string(),
        style: z.enum(['compact', 'full']).optional(),
        markdown: z.boolean().optional(),
      }),
    )
    .optional(),
});
