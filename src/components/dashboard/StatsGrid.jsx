import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@core/components/ui/card";
import { Building2, Leaf, Target, TrendingUp } from "lucide-react";
import { Skeleton } from "@core/components/ui/skeleton";

const StatCard = ({ title, value, subtitle, icon: Icon, gradient, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6, delay }}
  >
    <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300">
      <div className={`absolute inset-0 ${gradient} opacity-5`} />
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">
              {title}
            </p>
            <div className="space-y-1">
              <p className="text-3xl font-bold text-slate-800">
                {value}
              </p>
              {subtitle && (
                <p className="text-sm text-slate-600">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <div className={`p-3 rounded-xl ${gradient} bg-opacity-20`}>
            <Icon className={`w-6 h-6 ${gradient.replace('bg-', 'text-')}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

export default function StatsGrid({ stats, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        title="Total Projects"
        value={stats.total}
        subtitle={`${stats.active} active`}
        icon={Building2}
        gradient="bg-emerald-500"
        delay={0.1}
      />
      
      <StatCard
        title="Sustainability Avg"
        value={`${Math.round(stats.avgSustainability)}%`}
        subtitle="Climate optimized"
        icon={Leaf}
        gradient="bg-green-500"
        delay={0.2}
      />
      
      <StatCard
        title="Total Area"
        value={`${(stats.totalArea / 1000).toFixed(1)}k`}
        subtitle="m² under design"
        icon={Target}
        gradient="bg-blue-500"
        delay={0.3}
      />
      
      <StatCard
        title="Efficiency Gain"
        value="87%"
        subtitle="vs conventional"
        icon={TrendingUp}
        gradient="bg-purple-500"
        delay={0.4}
      />
    </div>
  );
}