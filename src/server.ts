import express, { Application, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import connectDB from "./config/dbConnection";
import rateLimit from "express-rate-limit";
import corsOptions from "./config/corOptions";
import { errorHandler, routeNotFound } from "./middleware/errorMiddleware";
//Routes
import auth from "./routes/AdminFeature/auth";
import userManagementRoutes from "./routes/AdminFeature/userManagement";

import bikes from "./routes/BikeSystemRoutes/bikes.routes";
import bikeImages from "./routes/BikeSystemRoutes/bikeImages.routes";
import enquiryRoutes from "./routes/CustomerRequest/enquiryForm";
import branchRoutes from "./routes/AdminFeature/branches";
import cloudinaryRoutes from "./routes/cloudinary";
import getApprovedRoutes from "./routes/CustomerRequest/getapproved";
import visitorRoutes from "./routes/visitorR";
import contactRoutes from "./routes/CustomerRequest/contact";
import customerRoutes from "./routes/customerRoutes/customer";
import customerProfile from "./routes/customerRoutes/customerProfile";
import serviceBookingRoutes from "./routes/customerRoutes/serviceBooking";
import valueAddedServicesRoutes from "./routes/BikeSystemRoutes2/VAS";
import vehicleInfoRoutes from "./routes/BikeSystemRoutes2/CustomerVehicleRoutes";
import stockConceptRoutes from "./routes/BikeSystemRoutes2/stockConcept";
import csvStockImportRoutes from "./routes/BikeSystemRoutes3/csvStock";
import b2bSalesRoutes from "./routes/b2bSales.routes";
import accidentReports from "./routes/AdminFeature/accidentReport";
//
import leaveRoutes from "./routes/NewFeatures/leave_routes";
import quotationRoutes from "./routes/NewFeatures/quotation_routes";
import jobCardRoutes from "./routes/ServiceM/jobCard";
import jobCardCatalogRoutes from "./routes/ServiceM/jobCardCatalog";
import invoiceRoutes from "./routes/ServiceM/invoice_routes";

//
import scanfleetRoutes from "./routes/Scanfleet/routes.scanfleet";
import googlePlacesRoutes from "./routes/googlePlaces";
import partsRoutes from "./routes/Parts/parts";
import maintenanceServiceRoutes from "./routes/Maintenance/maintenanceService";
import counterSaleRoutes from "./routes/CounterSale/counterSale";
import serviceJobcardRoutes from "./routes/ServiceJobcard/serviceJobcard";
import salesReportRoutes from "./routes/SalesReport/salesReport";
import dataImportRoutes from "./routes/DataImport/dataImport";
import ragRoutes from "./routes/Rag/rag.routes";
import notificationRoutes from "./routes/Notifications/notifications";
import { validateRequiredEnv } from "./config/validateEnv";

dotenv.config();
validateRequiredEnv();

// Create Express application
const app: Application = express();
const PORT = process.env.PORT || 8080;

//CORS
app.use(cors(corsOptions));
app.use(cookieParser());

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting (only applied to auth routes)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again after 15 minutes",
});

// Health check endpoints (no rate limiting)
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Honda-Dealer Golaghat API is running",
    version: "1.0.0",
  });
});
app.get("/_ah/health", (req: Request, res: Response) => {
  res.status(200).send("OK");
});

app.get("/_ah/start", (req: Request, res: Response) => {
  res.status(200).send("OK");
});

// Admin & Auth (rate limiting only on auth)
app.use("/api/auth", apiLimiter, auth);
app.use("/api/users", userManagementRoutes);

//create Branch
app.use("/api/branch", branchRoutes);
// Bike System
app.use("/api/bikes", bikes);
app.use("/api/bike-images", bikeImages);
app.use("/api/stock-concept", stockConceptRoutes);
app.use("/api/value-added-services", valueAddedServicesRoutes);
app.use("/api/csv-stock", csvStockImportRoutes);
app.use("/api/b2b-sales", b2bSalesRoutes);

// Customer System
app.use("/api/customer", customerRoutes);
app.use("/api/customer-profile", customerProfile);
app.use("/api/customer-vehicles", vehicleInfoRoutes);
app.use("/api/service-bookings", serviceBookingRoutes);

// Other Services
app.use("/api/cloudinary", cloudinaryRoutes);

app.use("/api/accident-reports", accidentReports);
app.use("/api/visitor", visitorRoutes);

// Cstomer Request
app.use("/api/enquiry-form", enquiryRoutes);
app.use("/api/getapproved", getApprovedRoutes);
app.use("/api/messages", contactRoutes);

//
app.use("/api/leaves", leaveRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/job-cards", jobCardRoutes);
app.use("/api/job-card-catalog", jobCardCatalogRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/parts", partsRoutes);
app.use("/api/maintenance", maintenanceServiceRoutes);
app.use("/api/counter-sale", counterSaleRoutes);
app.use("/api/service-jobcard", serviceJobcardRoutes);
app.use("/api/sales-report", salesReportRoutes);
//
app.use("/api/data-import", dataImportRoutes);
app.use("/api/rag", ragRoutes);
app.use("/api/notifications", notificationRoutes);

//Third Party
app.use("/api/scanfleet", scanfleetRoutes);
app.use("/api/google-places", googlePlacesRoutes);

// 404 handler
app.use(routeNotFound);

// Custom error handler
app.use(errorHandler);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
});

export default app;
