import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { getAllowedDatasetsForRole } from "../../models/DataImport/datasetRegistry";
import { getUserRole } from "../../types/user.types";

/**
 * @desc    Datasets + canonical fields the current role may import.
 * @route   GET /api/data-import/config
 * @access  Any authenticated role
 */
export const getDataImportConfig = asyncHandler(
  async (req: Request, res: Response) => {
    const role = getUserRole(req.user!);
    const datasets = getAllowedDatasetsForRole(role).map((d) => ({
      datasetType: d.datasetType,
      label: d.label,
      sourceFormats: d.sourceFormats,
      fields: d.fields.map((f) => ({
        key: f.key,
        label: f.label,
        required: f.required,
      })),
    }));

    res.status(200).json({
      success: true,
      data: { role, datasets },
    });
  },
);
