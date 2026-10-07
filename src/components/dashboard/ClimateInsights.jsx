import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { 
  Thermometer, 
  Droplets, 
  Wind, 
  Sun,
  TrendingUp,
  AlertTriangle
} from "lucide-react";

export default function ClimateInsights({ projects }) {
  
  const getClimateDistribution = () => {
    const distribution = {};
    projects.forEach(project => {
      distribution[project.climate_zone] = (distribution[project.climate_zone] || 0) + 1;
    });
    return Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  };

  const climateZoneIcons = {
    tropical: { icon: Sun, color: "text-orange-500" },
    subtropical: { icon: Thermometer, color: "text-red-500" },
    temperate: { icon: Wind, color: "text-blue-500" },
    mediterranean: { icon: Sun, color: "text-yellow-500" },
    continental: { icon: Wind, color: "text-slate-500" },
    arid: { icon: Sun, color: "text-amber-500" },
    polar: { icon: Droplets, color: "text-cyan-500" }
  };

  const climateData = getClimateDistribution();
  
  const insights = [
    {
      title: "Rising Temperatures",
      description: "Global avg +1.2°C since 1850",
      trend: "+0.15°C/decade",
      icon: TrendingUp,
      severity: "high"
    },
    {
      title: "Precipitation Changes", 
      description: "Irregular patterns affecting design",
      trend: "±20% variance",
      icon: Droplets,
      severity: "medium"
    },
    {
      title: "Extreme Weather Events",
      description: "Increase in frequency and intensity",
      trend: "+40% since 2000",
      icon: AlertTriangle,
      severity: "high"
    }
  ];

  return (
    <div className="space-y-6">
      
      {/* Climate Zone Distribution */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <Card className="border-0 shadow-lg bg-gradient-to-br from-emerald-50 to-teal-50">
          <CardHeader>
            <CardTitle className="text-lg text-slate-800">Climate Zones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {climateData.length > 0 ? (
              climateData.map(([zone, count]) => {
                const { icon: Icon, color } = climateZoneIcons[zone] || { icon: Thermometer, color: "text-slate-500" };
                return (
                  <div key={zone} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${color}`} />
                      <span className="capitalize text-sm font-medium">{zone}</span>
                    </div>
                    <Badge variant="outline" className="bg-white/60">
                      {count} project{count !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">
                No climate data available yet
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Climate Insights */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg text-slate-800">Climate Insights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {insights.map((insight, index) => (
              <div key={index} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
                <div className={`p-2 rounded-lg ${
                  insight.severity === 'high' ? 'bg-red-100' : 'bg-blue-100'
                }`}>
                  <insight.icon className={`w-4 h-4 ${
                    insight.severity === 'high' ? 'text-red-600' : 'text-blue-600'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm text-slate-800">{insight.title}</h4>
                  <p className="text-xs text-slate-600 mt-1">{insight.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">
                      {insight.trend}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}