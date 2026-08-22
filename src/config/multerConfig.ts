import multer from "multer";
import { Request } from "express";

// Enhanced file filter for multiple image types
const imageFileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (file.mimetype.startsWith("image/")) {
    const allowedImageTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/bmp",
      "image/tiff",
      "image/svg+xml",
    ];

    if (allowedImageTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Image format ${file.mimetype} not supported. 
Supported formats: JPEG, PNG, WebP, GIF, BMP, TIFF, SVG`
        )
      );
    }
  } else {
    cb(new Error("Only image files are allowed"));
  }
};

// Enhanced multer configuration for bike uploads
export const bikeUploadConfig = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per image
    files: 10, // Maximum 10 images for bikes
  },
  fileFilter: imageFileFilter,
});

// Enhanced error handler for multer errors
export const handleMulterError = (
  error: any,
  req: Request,
  res: any,
  next: any
) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return res.status(400).json({
          success: false,
          message: "File size too large",
          error: `Maximum file size allowed is ${
            error.field === "video" ? "500MB" : "10MB"
          }`,
        });
      case "LIMIT_FILE_COUNT":
        return res.status(400).json({
          success: false,
          message: "Too many files",
          error: `Maximum ${
            req.route.path.includes("bike")
              ? "10"
              : req.route.path.includes("photo")
              ? "10"
              : req.route.path.includes("press")
              ? "5"
              : "2"
          } files allowed`,
        });
      case "LIMIT_UNEXPECTED_FILE":
        return res.status(400).json({
          success: false,
          message: "Unexpected field",
          error: "Only allowed file fields are accepted",
        });
      default:
        return res.status(400).json({
          success: false,
          message: "File upload error",
          error: error.message,
        });
    }
  }

  // Handle custom file filter errors
  if (
    error.message.includes("not supported") ||
    error.message.includes("required") ||
    error.message.includes("Only")
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid file type",
      error: error.message,
    });
  }

  // Pass other errors to the general error handler
  next(error);
};
// Stock CSV upload — accepts CSV and Excel (xls/xlsx) files.
const CSV_STOCK_EXTENSIONS = [".csv", ".xls", ".xlsx"];
const CSV_STOCK_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export const csvUploadConfig = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const okByExt = CSV_STOCK_EXTENSIONS.some((ext) => name.endsWith(ext));
    const okByMime = CSV_STOCK_MIME_TYPES.includes(file.mimetype);
    if (okByExt || okByMime) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV, XLS, and XLSX files allowed"));
    }
  },
});

// Parts report upload — accepts spreadsheet (xlsx/csv) and PDF files.
const PARTS_REPORT_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
];
const PARTS_REPORT_EXTENSIONS = [".csv", ".xls", ".xlsx", ".pdf"];

export const partsReportConfig = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB (PDFs can be larger)
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const okByExt = PARTS_REPORT_EXTENSIONS.some((ext) => name.endsWith(ext));
    const okByMime = PARTS_REPORT_MIME_TYPES.includes(file.mimetype);
    if (okByExt || okByMime) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV, XLSX, and PDF files allowed"));
    }
  },
});

// Counter sale report upload — accepts spreadsheet (xlsx/csv) files only.
const COUNTER_SALE_REPORT_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const COUNTER_SALE_REPORT_EXTENSIONS = [".csv", ".xls", ".xlsx"];

export const counterSaleReportConfig = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const okByExt = COUNTER_SALE_REPORT_EXTENSIONS.some((ext) =>
      name.endsWith(ext),
    );
    const okByMime = COUNTER_SALE_REPORT_MIME_TYPES.includes(file.mimetype);
    if (okByExt || okByMime) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and XLSX files allowed"));
    }
  },
});

// Sales report upload (already-sold vehicles) — accepts spreadsheet
// (xlsx/csv) files only.
const SALES_REPORT_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const SALES_REPORT_EXTENSIONS = [".csv", ".xls", ".xlsx"];

export const salesReportConfig = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const okByExt = SALES_REPORT_EXTENSIONS.some((ext) => name.endsWith(ext));
    const okByMime = SALES_REPORT_MIME_TYPES.includes(file.mimetype);
    if (okByExt || okByMime) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and XLSX files allowed"));
    }
  },
});
