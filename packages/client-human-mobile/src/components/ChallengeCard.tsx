// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ActiveChallenge } from '../lib/stores/challenges';

interface ChallengeCardProps {
  challenge: ActiveChallenge;
  onApprove?: () => void;
  onModify?: () => void;
  onCancel?: () => void;
}

export function ChallengeCard({ challenge, onApprove, onModify, onCancel }: ChallengeCardProps) {
  const { payload } = challenge;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>!</Text>
        <Text style={styles.headerText}>Safety Challenge — Layer {payload.layer}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Reason</Text>
        <Text style={styles.text}>{payload.reason}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Risk Assessment</Text>
        <Text style={styles.text}>{payload.riskAssessment}</Text>
      </View>

      {payload.factors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Factors</Text>
          {payload.factors.map((factor, i) => (
            <View key={i} style={styles.factor}>
              <View style={styles.factorHeader}>
                <Text style={styles.factorName}>{factor.name}</Text>
                <Text style={styles.factorWeight}>{(factor.weight * 100).toFixed(0)}%</Text>
              </View>
              <Text style={styles.factorDesc}>{factor.description}</Text>
              <View style={styles.weightBar}>
                <View
                  style={[
                    styles.weightFill,
                    { width: `${Math.min(100, factor.weight * 100)}%` },
                    factor.weight > 0.7 ? styles.weightHigh : factor.weight > 0.4 ? styles.weightMed : styles.weightLow,
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {payload.suggestedAlternatives.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Suggested Alternatives</Text>
          {payload.suggestedAlternatives.map((alt, i) => (
            <Text key={i} style={styles.alternative}>
              • {alt}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.modifyButton} onPress={onModify}>
          <Text style={styles.modifyText}>Modify</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.approveButton} onPress={onApprove}>
          <Text style={styles.approveText}>Proceed</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e2e',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f9e2af',
  },
  headerIcon: {
    color: '#f9e2af',
    fontSize: 20,
    fontWeight: '700',
    width: 28,
    height: 28,
    textAlign: 'center',
    lineHeight: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(249,226,175,0.15)',
  },
  headerText: {
    color: '#f9e2af',
    fontSize: 16,
    fontWeight: '700',
  },
  section: {
    marginBottom: 16,
  },
  label: {
    color: '#89b4fa',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  text: {
    color: '#cdd6f4',
    fontSize: 14,
    lineHeight: 20,
  },
  factor: {
    backgroundColor: '#313244',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  factorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  factorName: {
    color: '#cdd6f4',
    fontSize: 13,
    fontWeight: '600',
  },
  factorWeight: {
    color: '#6c7086',
    fontSize: 12,
  },
  factorDesc: {
    color: '#a6adc8',
    fontSize: 12,
    marginBottom: 6,
  },
  weightBar: {
    height: 4,
    backgroundColor: '#45475a',
    borderRadius: 2,
  },
  weightFill: {
    height: 4,
    borderRadius: 2,
  },
  weightLow: {
    backgroundColor: '#a6e3a1',
  },
  weightMed: {
    backgroundColor: '#f9e2af',
  },
  weightHigh: {
    backgroundColor: '#f38ba8',
  },
  alternative: {
    color: '#a6adc8',
    fontSize: 13,
    lineHeight: 20,
    paddingLeft: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#313244',
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#313244',
  },
  cancelText: {
    color: '#cdd6f4',
    fontWeight: '500',
  },
  modifyButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#45475a',
  },
  modifyText: {
    color: '#cdd6f4',
    fontWeight: '500',
  },
  approveButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f9e2af',
  },
  approveText: {
    color: '#1e1e2e',
    fontWeight: '700',
  },
});
