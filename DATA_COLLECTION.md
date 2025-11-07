# Data Collection Cron Job Documentation

This document describes the enhanced data collection features implemented in the cron job (`util/updatesingle.mjs`).

## Features

### 1. Automatic Data Archiving

Before each data collection run, the system automatically archives the previous `mods.json` and `authors.json` files.

- **Archive Location**: `data/archive/`
- **Naming Format**: `mods-YYYY-MM-DD.json` and `authors-YYYY-MM-DD.json`
- **Date Source**: Uses the `generatedAt` timestamp from the previous data file

Example archive files:
```
data/archive/mods-2025-11-05.json
data/archive/authors-2025-11-05.json
```

### 2. Monthly Download Rate Calculation

When an archive exists that is at least 20 days old, the system calculates a `downloadRateMonthly` for each mod and author.

#### Calculation Formula

For mods:
```
downloadRateMonthly = (currentDownloads - previousDownloads) / daysSinceArchive
```

For authors:
```
downloadRateMonthly = sum of all downloadRateMonthly from their mods
```

- If a mod exists in the current data but not in the archive, `previousDownloads` is treated as 0
- The rate represents average downloads per day over the period
- Author monthly rates are the sum of monthly rates from all their mods

#### Output Format

**Mods** - When monthly rates are available:
```json
{
  "generatedAt": "2025-11-05T10:00:00.000Z",
  "monthlyRate": "available",
  "mods": [
    {
      "id": 123456,
      "name": "Example Mod",
      "downloadCount": 1000,
      "downloadRate": 5.23,
      "downloadRateMonthly": 10.5,
      ...
    }
  ]
}
```

When monthly rates are unavailable (no archive ≥20 days old):
```json
{
  "generatedAt": "2025-11-05T10:00:00.000Z",
  "monthlyRate": "unavailable",
  "mods": [
    {
      "id": 123456,
      "name": "Example Mod",
      "downloadCount": 1000,
      "downloadRate": 5.23,
      ...
    }
  ]
}
```

**Authors** - When monthly rates are available:
```json
{
  "generatedAt": "2025-11-05T10:00:00.000Z",
  "monthlyRate": "available",
  "authors": [
    {
      "name": "ExampleAuthor",
      "downloadCount": 5000,
      "mods": 3,
      "downloadRate": 25.5,
      "daysExisting": 196.2,
      "downloadRateMonthly": 30.5
    }
  ]
}
```

When monthly rates are unavailable:
```json
{
  "generatedAt": "2025-11-05T10:00:00.000Z",
  "monthlyRate": "unavailable",
  "authors": [
    {
      "name": "ExampleAuthor",
      "downloadCount": 5000,
      "mods": 3,
      "downloadRate": 25.5,
      "daysExisting": 196.2
    }
  ]
}
```

Note: The `downloadRateMonthly` field is only added to mods and authors when `monthlyRate` is "available".

### 3. Archive Cleanup

The system automatically manages archive storage by keeping a maximum of 32 days of archives.

- **Trigger**: Cleanup runs after each data collection
- **Retention**: Only the 32 most recent archives are kept
- **Deletion Order**: Oldest archives are deleted first

Example:
- If 35 archives exist, the 3 oldest will be deleted
- If 32 or fewer archives exist, no cleanup occurs

### 4. Data Collection Logging

All data collection runs are logged to `data/dataCollectionLog.txt`.

#### Log Format

```
[2025-11-05T10:00:00.000Z] Mods collected 869 (diff +2 -0)
```

Components:
- **Timestamp**: ISO 8601 format
- **Mod Count**: Total mods collected in this run
- **Diff**: Shows added (+) and removed (-) mods compared to previous run
  - Format: `(diff +X -Y)` where X is added, Y is removed
  - Only appears if previous data exists

#### Console Output

The same information is also printed to console:
```
Mods collected 869 (diff +2 -0)
```

This helps identify if mods are going missing between runs.

## Execution Flow

Each time the cron job runs, it performs these steps in order:

1. **Fetch data** from CurseForge API
2. **Archive previous data** (if exists)
3. **Check previous mod count** for integrity tracking
4. **Find old archive** (≥20 days) for monthly rate calculation
5. **Process and filter mods**
6. **Calculate download rates** (daily and monthly)
7. **Calculate author statistics**
8. **Write output files** (`mods.json`, `authors.json`)
9. **Log collection results** with mod count diff
10. **Clean up old archives** (keep max 32 days)

## File Structure

```
data/
├── mods.json                    # Current mod data
├── authors.json                 # Current author data
├── dataCollectionLog.txt        # Collection history log
└── archive/                     # Historical data
    ├── mods-2025-10-15.json
    ├── authors-2025-10-15.json
    ├── mods-2025-10-16.json
    ├── authors-2025-10-16.json
    └── ... (up to 32 days)
```

## Example Scenarios

### Scenario 1: First Run (No Previous Data)

```
No previous data to archive or error archiving: ...
Processed 869 mods and saved to ./data/mods.json
Saved 245 unique authors to ./data/authors.json
Mods collected 869
```

Output:
- No archive created
- No monthly rates calculated (`monthlyRate: "unavailable"`)
- No diff in log (first run)

### Scenario 2: Second Run (Less than 20 days later)

```
Archived previous data as mods-2025-11-05.json and authors-2025-11-05.json
Processed 871 mods and saved to ./data/mods.json
Saved 247 unique authors to ./data/authors.json
Mods collected 871 (diff +2 -0)
```

Output:
- Archive created from previous run
- No monthly rates yet (`monthlyRate: "unavailable"`)
- Diff shows 2 new mods

### Scenario 3: Run After 20+ Days

```
Archived previous data as mods-2025-11-25.json and authors-2025-11-25.json
Found archive from 2025-11-05 (20.5 days ago) for monthly rate calculation
Processed 875 mods and saved to ./data/mods.json
Saved 248 unique authors to ./data/authors.json
Mods collected 875 (diff +4 -0)
```

Output:
- Archive created
- Monthly rates calculated using 20-day-old archive (`monthlyRate: "available"`)
- All mods have `downloadRateMonthly` field
- Diff shows 4 new mods

### Scenario 4: Run with >32 Archives

```
Archived previous data as mods-2025-12-08.json and authors-2025-12-08.json
Found archive from 2025-11-18 (20.3 days ago) for monthly rate calculation
Processed 880 mods and saved to ./data/mods.json
Saved 250 unique authors to ./data/authors.json
Mods collected 880 (diff +5 -0)
Archive count: 35 (max: 32) - deleting 3 oldest
Deleted old archive: 2025-11-05
Deleted old archive: 2025-11-06
Deleted old archive: 2025-11-07
```

Output:
- Archive created
- Monthly rates calculated
- 3 oldest archives deleted to maintain max of 32

## Monitoring and Maintenance

### Check Archive Status

```bash
ls -la data/archive/ | wc -l
```

### View Recent Logs

```bash
tail -20 data/dataCollectionLog.txt
```

### Verify Monthly Rate Status

```bash
jq '.monthlyRate' data/mods.json
```

### Check Sample Mod Data

```bash
jq '.mods[0]' data/mods.json
```

## Notes

- Archives are stored in the `data/` directory, which is excluded from git by `.gitignore`
- The cron job runs daily at midnight (configured in `src/index.mjs`)
- Monthly rate calculation uses the oldest available archive that is at least 20 days old
- If multiple archives meet the 20-day threshold, the oldest one is used for more accurate long-term trends
