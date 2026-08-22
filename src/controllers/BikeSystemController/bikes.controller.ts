// controllers/bikes.controller.ts
import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import BikeModel from "../../models/BikeSystemModel/Bikes";
import BikeImageModel from "../../models/BikeSystemModel/BikeImageModel";

/**
 * @desc    Get all bikes with images
 * @route   GET /api/bikes
 * @access  Public
 */
export const getBikes = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const category = req.query.category as string;
  const mainCategory = req.query.mainCategory as string;
  const year = req.query.year as string;
  const minPrice = req.query.minPrice as string;
  const maxPrice = req.query.maxPrice as string;
  const inStock = req.query.inStock as string;
  const fuelNorms = req.query.fuelNorms as string;
  const isE20Efficiency = req.query.isE20Efficiency as string;

  // Build filter query
  let filter: any = { isActive: true };

  if (mainCategory) filter.mainCategory = mainCategory;
  if (category) filter.category = category;
  if (year) filter.year = parseInt(year);
  if (inStock === "true") filter.stockAvailable = { $gt: 0 };
  if (fuelNorms) filter.fuelNorms = fuelNorms;
  if (isE20Efficiency === "true") filter.isE20Efficiency = true;
  if (isE20Efficiency === "false") filter.isE20Efficiency = false;

  // Price filtering
  if (minPrice || maxPrice) {
    filter["priceBreakdown.onRoadPrice"] = {};
    if (minPrice)
      filter["priceBreakdown.onRoadPrice"].$gte = parseFloat(minPrice);
    if (maxPrice)
      filter["priceBreakdown.onRoadPrice"].$lte = parseFloat(maxPrice);
  }

  const skip = (page - 1) * limit;

  const [bikes, total] = await Promise.all([
    BikeModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BikeModel.countDocuments(filter),
  ]);

  // Get images for each bike
  const bikesWithImages = await Promise.all(
    bikes.map(async (bike) => {
      const images = await BikeImageModel.find({
        bikeId: bike._id,
        isActive: true,
      })
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean();

      return {
        ...bike,
        images,
      };
    }),
  );

  res.status(200).json({
    success: true,
    data: {
      bikes: bikesWithImages,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    },
  });
});

/**
 * @desc    Get single bike by ID with images
 * @route   GET /api/bikes/:id
 * @access  Public
 */
export const getBikeById = asyncHandler(async (req: Request, res: Response) => {
  const bike = await BikeModel.findById(req.params.id);

  if (!bike || !bike.isActive) {
    res.status(404);
    throw new Error("Vehicle not found");
  }

  // Get images for this bike
  const images = await BikeImageModel.find({
    bikeId: bike._id,
    isActive: true,
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  const bikeWithImages = {
    ...bike.toObject(),
    images,
  };

  res.status(200).json({
    success: true,
    data: bikeWithImages,
  });
});

/**
 * @desc    Create new bike (Step 1 - Basic Info)
 * @route   POST /api/bikes
 * @access  Private/Super-Admin, Branch-Admin
 */
export const createBike = asyncHandler(async (req: Request, res: Response) => {
  const {
    modelName,
    mainCategory,
    category,
    year,
    variants,
    priceBreakdown,
    engineSize,
    power,
    transmission,
    fuelNorms,
    isE20Efficiency,
    features,
    colors,
    stockAvailable,
    isNewModel,
  } = req.body;

  // Validate required fields
  if (
    !modelName ||
    !mainCategory ||
    !category ||
    !year ||
    !priceBreakdown ||
    !engineSize ||
    !power ||
    !transmission ||
    !fuelNorms ||
    isE20Efficiency === undefined
  ) {
    res.status(400).json({
      success: false,
      error: "Please provide all required fields",
    });
    return;
  }

  // Check for duplicate
  const existingBike = await BikeModel.findOne({
    modelName: modelName.trim(),
    year: parseInt(year),
    isActive: true,
  });

  if (existingBike) {
    res.status(400).json({
      success: false,
      error: `Vehicle model "${modelName}" for year ${year} already exists`,
    });
    return;
  }

  // Validate main category
  const validMainCategories = ["bike", "scooter"];
  if (!validMainCategories.includes(mainCategory)) {
    res.status(400).json({
      success: false,
      error: `Invalid main category. Must be one of: ${validMainCategories.join(
        ", ",
      )}`,
    });
    return;
  }

  // Validate fuel norms
  const validFuelNorms = ["BS4", "BS6", "BS6 Phase 2", "Electric"];
  if (!validFuelNorms.includes(fuelNorms)) {
    res.status(400).json({
      success: false,
      error: `Invalid fuel norms. Must be one of: ${validFuelNorms.join(", ")}`,
    });
    return;
  }

  try {
    // Create bike document
    const bike = await BikeModel.create({
      modelName: modelName.trim(),
      mainCategory,
      category,
      year: parseInt(year),
      variants: variants || [
        {
          name: "Standard",
          features: [],
          priceAdjustment: 0,
          isAvailable: true,
        },
      ],
      priceBreakdown: {
        exShowroomPrice: parseFloat(priceBreakdown.exShowroomPrice),
        rtoCharges: parseFloat(priceBreakdown.rtoCharges),
        insuranceComprehensive: parseFloat(
          priceBreakdown.insuranceComprehensive,
        ),
      },
      engineSize: engineSize.trim(),
      power: parseFloat(power),
      transmission: transmission.trim(),
      fuelNorms,
      isE20Efficiency: isE20Efficiency === "true" || isE20Efficiency === true,
      features: features || [],
      colors: colors || [],
      stockAvailable: parseInt(stockAvailable) || 0,
      isNewModel: isNewModel === "true" || isNewModel === true,
    });

    res.status(201).json({
      success: true,
      message: `${
        mainCategory === "bike" ? "Bike" : "Scooter"
      } created successfully. Now you can upload images using the bike ID: ${
        bike._id
      }`,
      data: {
        bikeId: bike._id,
        ...bike.toObject(),
      },
    });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: "Vehicle model with this name and year already exists",
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: error.message || "Failed to create vehicle",
    });
  }
});

/**
 * @desc    Update bike
 * @route   PUT /api/bikes/:id
 * @access  Private/Super-Admin, Branch-Admin
 */
export const updateBike = asyncHandler(async (req: Request, res: Response) => {
  const bike = await BikeModel.findById(req.params.id);

  if (!bike) {
    res.status(404);
    throw new Error("Vehicle not found");
  }

  const {
    modelName,
    mainCategory,
    category,
    year,
    variants,
    priceBreakdown,
    engineSize,
    power,
    transmission,
    fuelNorms,
    isE20Efficiency,
    features,
    colors,
    stockAvailable,
    isNewModel,
    isActive,
  } = req.body;

  try {
    // Check for duplicate model name and year (excluding current bike)
    if (modelName && year) {
      const existingBike = await BikeModel.findOne({
        _id: { $ne: req.params.id },
        modelName: modelName.trim(),
        year: parseInt(year),
        isActive: true,
      });

      if (existingBike) {
        res.status(400).json({
          success: false,
          error: `Vehicle model "${modelName}" for year ${year} already exists`,
        });
        return;
      }
    }

    // Update fields
    if (modelName !== undefined) bike.modelName = modelName.trim();
    if (mainCategory !== undefined) bike.mainCategory = mainCategory;
    if (category !== undefined) bike.category = category;
    if (year !== undefined) bike.year = parseInt(year);
    if (fuelNorms !== undefined) bike.fuelNorms = fuelNorms;
    if (isE20Efficiency !== undefined)
      bike.isE20Efficiency =
        isE20Efficiency === "true" || isE20Efficiency === true;

    if (variants !== undefined) {
      bike.variants =
        typeof variants === "string" ? JSON.parse(variants) : variants;
    }
    if (priceBreakdown !== undefined) {
      bike.priceBreakdown = {
        exShowroomPrice: parseFloat(priceBreakdown.exShowroomPrice),
        rtoCharges: parseFloat(priceBreakdown.rtoCharges),
        insuranceComprehensive: parseFloat(
          priceBreakdown.insuranceComprehensive,
        ),
      };
    }
    if (engineSize !== undefined) bike.engineSize = engineSize.trim();
    if (power !== undefined) bike.power = parseFloat(power);
    if (transmission !== undefined) bike.transmission = transmission.trim();
    if (features !== undefined) {
      bike.features =
        typeof features === "string" ? JSON.parse(features) : features;
    }
    if (colors !== undefined) {
      bike.colors = typeof colors === "string" ? JSON.parse(colors) : colors;
    }
    if (stockAvailable !== undefined)
      bike.stockAvailable = parseInt(stockAvailable);
    if (isNewModel !== undefined)
      bike.isNewModel = isNewModel === "true" || isNewModel === true;
    if (isActive !== undefined)
      bike.isActive = isActive === "true" || isActive === true;

    const updatedBike = await bike.save();

    res.status(200).json({
      success: true,
      message: "Vehicle updated successfully",
      data: updatedBike,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: "Vehicle model with this name and year already exists",
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: error.message || "Failed to update vehicle",
    });
  }
});

/**
 * @desc    Delete bike and its images
 * @route   DELETE /api/bikes/:id
 * @access  Private/Super-Admin
 */
export const deleteBike = asyncHandler(async (req: Request, res: Response) => {
  const bike = await BikeModel.findById(req.params.id);

  if (!bike) {
    res.status(404);
    throw new Error("Vehicle not found");
  }

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Delete all images associated with this bike
    await BikeImageModel.deleteMany({ bikeId: bike._id }).session(session);

    // Delete bike
    await BikeModel.findByIdAndDelete(req.params.id).session(session);

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Vehicle and associated images deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// Additional controller functions for search, category filters etc. remain the same
// but should include the image population logic shown above

/**
 * @desc    Search bikes with images
 * @route   GET /api/bikes/search
 * @access  Public
 */
export const searchBikes = asyncHandler(async (req: Request, res: Response) => {
  const { query } = req.query;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const mainCategory = req.query.mainCategory as string;
  const skip = (page - 1) * limit;

  if (!query) {
    res.status(400).json({
      success: false,
      error: "Search query is required",
    });
    return;
  }

  const searchRegex = new RegExp(query as string, "i");
  let filter: any = {
    isActive: true,
    $or: [
      { modelName: searchRegex },
      { category: searchRegex },
      { mainCategory: searchRegex },
      { fuelNorms: searchRegex },
      { features: { $in: [searchRegex] } },
      { colors: { $in: [searchRegex] } },
    ],
  };

  if (mainCategory) filter.mainCategory = mainCategory;

  const [bikes, total] = await Promise.all([
    BikeModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BikeModel.countDocuments(filter),
  ]);

  // Get images for each bike
  const bikesWithImages = await Promise.all(
    bikes.map(async (bike) => {
      const images = await BikeImageModel.find({
        bikeId: bike._id,
        isActive: true,
      })
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean();

      return {
        ...bike,
        images,
      };
    }),
  );

  res.status(200).json({
    success: true,
    data: {
      bikes: bikesWithImages,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    },
  });
});
/**
 * @desc    Get bikes by category
 * @route   GET /api/bikes/category/:category
 * @access  Public
 */
export const getBikesByCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const { category } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const mainCategory = req.query.mainCategory as string;
    const skip = (page - 1) * limit;

    const validCategories = [
      "sport",
      "adventure",
      "cruiser",
      "touring",
      "naked",
      "electric",
      "commuter",
      "automatic",
      "gearless",
    ];

    if (!validCategories.includes(category)) {
      res.status(400).json({
        success: false,
        error: "Invalid category",
      });
      return;
    }

    let filter: any = { category, isActive: true };
    if (mainCategory) filter.mainCategory = mainCategory;

    const [bikes, total] = await Promise.all([
      BikeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BikeModel.countDocuments(filter),
    ]);

    const bikesWithImages = await Promise.all(
      bikes.map(async (bike) => {
        const images = await BikeImageModel.find({
          bikeId: bike._id,
          isActive: true,
        })
          .sort({ isPrimary: -1, createdAt: 1 })
          .lean();

        return {
          ...bike,
          images,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: {
        bikes: bikesWithImages,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      },
    });
  },
);

/**
 * @desc    Get bikes by main category (bikes or scooters)
 * @route   GET /api/bikes/main-category/:mainCategory
 * @access  Public
 */
export const getBikesByMainCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const { mainCategory } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const category = req.query.category as string;
    const fuelNorms = req.query.fuelNorms as string;
    const isE20Efficiency = req.query.isE20Efficiency as string;
    const skip = (page - 1) * limit;

    if (!["bike", "scooter"].includes(mainCategory)) {
      res.status(400).json({
        success: false,
        error: "Invalid main category. Must be either 'bike' or 'scooter'",
      });
      return;
    }

    let filter: any = { mainCategory, isActive: true };
    if (category) filter.category = category;
    if (fuelNorms) filter.fuelNorms = fuelNorms;
    if (isE20Efficiency === "true") filter.isE20Efficiency = true;
    if (isE20Efficiency === "false") filter.isE20Efficiency = false;

    const [bikes, total] = await Promise.all([
      BikeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BikeModel.countDocuments(filter),
    ]);

    const bikesWithImages = await Promise.all(
      bikes.map(async (bike) => {
        const images = await BikeImageModel.find({
          bikeId: bike._id,
          isActive: true,
        })
          .sort({ isPrimary: -1, createdAt: 1 })
          .lean();

        return {
          ...bike,
          images,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: {
        bikes: bikesWithImages,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      },
    });
  },
);

/**
 * @desc    Get vehicles by fuel norms
 * @route   GET /api/bikes/fuel-norms/:fuelNorms
 * @access  Public
 */
export const getBikesByFuelNorms = asyncHandler(
  async (req: Request, res: Response) => {
    const { fuelNorms } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const mainCategory = req.query.mainCategory as string;
    const skip = (page - 1) * limit;

    const validFuelNorms = ["BS4", "BS6", "BS6 Phase 2", "Electric"];
    if (!validFuelNorms.includes(fuelNorms)) {
      res.status(400).json({
        success: false,
        error: "Invalid fuel norms",
      });
      return;
    }

    let filter: any = { fuelNorms, isActive: true };
    if (mainCategory) filter.mainCategory = mainCategory;

    const [bikes, total] = await Promise.all([
      BikeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BikeModel.countDocuments(filter),
    ]);

    const bikesWithImages = await Promise.all(
      bikes.map(async (bike) => {
        const images = await BikeImageModel.find({
          bikeId: bike._id,
          isActive: true,
        })
          .sort({ isPrimary: -1, createdAt: 1 })
          .lean();

        return {
          ...bike,
          images,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: {
        bikes: bikesWithImages,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      },
    });
  },
);

/**
 * @desc    Get E20 efficient vehicles
 * @route   GET /api/bikes/e20-efficient
 * @access  Public
 */
export const getE20EfficientBikes = asyncHandler(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const mainCategory = req.query.mainCategory as string;
    const skip = (page - 1) * limit;

    let filter: any = { isE20Efficiency: true, isActive: true };
    if (mainCategory) filter.mainCategory = mainCategory;

    const [bikes, total] = await Promise.all([
      BikeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BikeModel.countDocuments(filter),
    ]);

    const bikesWithImages = await Promise.all(
      bikes.map(async (bike) => {
        const images = await BikeImageModel.find({
          bikeId: bike._id,
          isActive: true,
        })
          .sort({ isPrimary: -1, createdAt: 1 })
          .lean();

        return {
          ...bike,
          images,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: {
        bikes: bikesWithImages,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      },
    });
  },
);
