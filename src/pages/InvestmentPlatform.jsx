import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import { 
  MapPin, 
  Euro, 
  Building2, 
  Plus,
  Gavel,
  FileSignature, // Changed from FileContract
  Calculator
} from "lucide-react";
import { motion } from "framer-motion";

import LandListingForm from "../components/investment/LandListingForm";
import InvestmentBidForm from "../components/investment/InvestmentBidForm";
import ProjectDashboard from "../components/investment/ProjectDashboard";
import HOAIFeeCalculator from "../components/investment/HOAIFeeCalculator";
import { useI18n } from "@core/lib/i18n";

export default function InvestmentPlatform() {
  // 72-08 (N-02): the h1 is the menu title (src/navigation.js), same key.
  const { t } = useI18n();
  const [listings, setListings] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [myContracts, setMyContracts] = useState([]);
  const [activeTab, setActiveTab] = useState("marketplace");
  const [selectedListing, setSelectedListing] = useState(null);
  const [showListingForm, setShowListingForm] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const currentUser = await bitApi.auth.me();
      setUser(currentUser);
      
      const [listingsData, bidsData, contractsData] = await Promise.all([
        bitApi.entities.LandListing.list("-created_date"),
        bitApi.entities.InvestmentBid.filter({ bidder_id: currentUser.id }, "-submission_date"),
        bitApi.entities.ProjectContract.filter({ developer_id: currentUser.id }, "-start_date")
      ]);
      
      setListings(listingsData);
      setMyBids(bidsData);
      setMyContracts(contractsData);
    } catch (error) {
      console.error("Error loading data:", error);
    }
    setIsLoading(false);
  };

  const calculatePotentialProfit = (listing, investmentAmount) => {
    // Simple ROI calculation based on development potential
    const developmentValue = listing.land_area * 3000; // €3000/m² estimated
    const totalProfit = developmentValue - investmentAmount - listing.asking_price;
    return totalProfit > 0 ? totalProfit * (listing.profit_share_percentage / 100) : 0;
  };

  const getListingStatusColor = (status) => {
    const colors = {
      active: "bg-green-100 text-green-800",
      in_negotiation: "bg-blue-100 text-blue-800",
      under_contract: "bg-orange-100 text-orange-800",
      completed: "bg-gray-100 text-gray-800",
      cancelled: "bg-red-100 text-red-800"
    };
    return colors[status] || colors.active;
  };

  const LISTING_STATUS_LABELS = {
    active: "Aktiv",
    in_negotiation: "In Verhandlung",
    under_contract: "Unter Vertrag",
    sold: "Verkauft",
    completed: "Abgeschlossen",
    cancelled: "Storniert"
  };

  const BID_STATUS_LABELS = {
    pending: "Ausstehend",
    accepted: "Angenommen",
    rejected: "Abgelehnt",
    withdrawn: "Zurückgezogen",
    in_negotiation: "In Verhandlung"
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-4 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl shadow-xl">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              {t("Investment")}
            </h1>
          </div>
          <p className="text-xl text-slate-600 max-w-4xl mx-auto">
            Grundstückseigentümer, Investoren und Architekten zusammenbringen — mit
            integrierten HOAI-Honorarstrukturen und Gewinnbeteiligung.
          </p>
        </motion.div>

        {/* Platform Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="border-0 shadow-sm bg-white rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 w-fit mx-auto mb-3">
                <MapPin className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{listings.length}</h3>
              <p className="text-xs text-slate-500">Aktive Inserate</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 w-fit mx-auto mb-3">
                <Euro className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{(listings.reduce((sum, l) => sum + l.asking_price, 0) / 1000000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mio. €</h3>
              <p className="text-xs text-slate-500">Gesamtwert</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="p-2.5 rounded-xl bg-violet-50 text-violet-600 w-fit mx-auto mb-3">
                <Gavel className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{myBids.length}</h3>
              <p className="text-xs text-slate-500">Meine aktiven Gebote</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 w-fit mx-auto mb-3">
                <FileSignature className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{myContracts.length}</h3>
              <p className="text-xs text-slate-500">Aktive Projekte</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <div className="border-b border-slate-200 p-4">
                <TabsList className="grid w-full grid-cols-5 bg-slate-100">
                  <TabsTrigger value="marketplace" className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Marktplatz
                  </TabsTrigger>
                  <TabsTrigger value="my_listings" className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Meine Inserate
                  </TabsTrigger>
                  <TabsTrigger value="my_bids" className="flex items-center gap-2">
                    <Gavel className="w-4 h-4" />
                    Meine Gebote
                  </TabsTrigger>
                  <TabsTrigger value="contracts" className="flex items-center gap-2">
                    <FileSignature className="w-4 h-4" /> {/* Changed icon */}
                    Aktive Projekte
                  </TabsTrigger>
                  <TabsTrigger value="hoai_calculator" className="flex items-center gap-2">
                    <Calculator className="w-4 h-4" />
                    HOAI-Rechner
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="marketplace" className="p-6">
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-slate-800">Investitionsangebote</h2>
                    <Button
                      onClick={() => setShowListingForm(true)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Grundstück inserieren
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {listings.map(listing => (
                      <motion.div key={listing.id} whileHover={{ scale: 1.02 }}>
                        <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
                          <CardHeader className="pb-4">
                            <div className="flex justify-between items-start">
                              <div>
                                <CardTitle className="text-lg">{listing.title}</CardTitle>
                                <p className="text-sm text-slate-600 mt-1">{listing.location.address}</p>
                              </div>
                              <Badge className={getListingStatusColor(listing.status)}>
                                {LISTING_STATUS_LABELS[listing.status] || listing.status.replace('_', ' ')}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-slate-500">Grundstücksfläche</p>
                                <p className="font-semibold">{listing.land_area.toLocaleString("de-DE")} m²</p>
                              </div>
                              <div>
                                <p className="text-slate-500">Angebotspreis</p>
                                <p className="font-semibold">{listing.asking_price.toLocaleString("de-DE")} €</p>
                              </div>
                              <div>
                                <p className="text-slate-500">Gewinnbeteiligung</p>
                                <p className="font-semibold">{listing.profit_share_percentage}%</p>
                              </div>
                              <div>
                                <p className="text-slate-500">Mindestinvestition</p>
                                <p className="font-semibold">{listing.minimum_investment.toLocaleString("de-DE")} €</p>
                              </div>
                            </div>
                            
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600"
                                onClick={() => {
                                  setSelectedListing(listing);
                                  setShowBidForm(true);
                                }}
                              >
                                <Gavel className="w-4 h-4 mr-2" />
                                Gebot abgeben
                              </Button>
                              <Button size="sm" variant="outline">
                                Details
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="my_listings" className="p-6">
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-slate-800">Meine Grundstücksinserate</h2>
                    <Button
                      onClick={() => setShowListingForm(true)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Neues Inserat erstellen
                    </Button>
                  </div>

                  {/* User's listings would be filtered here */}
                  <p className="text-slate-400">Ihre Grundstücksinserate erscheinen hier.</p>
                </div>
              </TabsContent>

              <TabsContent value="my_bids" className="p-6">
                <div className="space-y-6">
                  <h2 className="text-2xl font-bold text-slate-800">Meine Investitionsgebote</h2>

                  {myBids.length === 0 ? (
                    <p className="text-slate-400">Keine aktiven Gebote. Entdecken Sie zunächst den Marktplatz.</p>
                  ) : (
                    <div className="space-y-4">
                      {myBids.map(bid => (
                        <Card key={bid.id} className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
                          <CardContent className="p-6">
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-semibold">Investition über {bid.investment_amount.toLocaleString("de-DE")} €</h3>
                                <p className="text-sm text-slate-600">Gewinnbeteiligung: {bid.proposed_profit_share}%</p>
                              </div>
                              <Badge>{BID_STATUS_LABELS[bid.status] || bid.status}</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="contracts" className="p-6">
                <ProjectDashboard contracts={myContracts} user={user} />
              </TabsContent>

              <TabsContent value="hoai_calculator" className="p-6">
                <HOAIFeeCalculator />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Forms */}
      {showListingForm && (
        <LandListingForm
          onSubmit={async (data) => {
            await bitApi.entities.LandListing.create({ ...data, owner_id: user.id });
            setShowListingForm(false);
            loadData();
          }}
          onCancel={() => setShowListingForm(false)}
        />
      )}

      {showBidForm && selectedListing && (
        <InvestmentBidForm
          listing={selectedListing}
          onSubmit={async (data) => {
            await bitApi.entities.InvestmentBid.create({ 
              ...data, 
              listing_id: selectedListing.id,
              bidder_id: user.id,
              submission_date: new Date().toISOString()
            });
            setShowBidForm(false);
            setSelectedListing(null);
            loadData();
          }}
          onCancel={() => {
            setShowBidForm(false);
            setSelectedListing(null);
          }}
        />
      )}
    </div>
  );
}