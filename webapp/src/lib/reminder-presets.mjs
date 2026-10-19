export const hourAhead = (now) => new Date(new Date(now).getTime() + 3600000).toISOString();
export const selectedPreset = (presets, value) => presets.find((preset) => preset.at === value)?.id ?? 'custom';
