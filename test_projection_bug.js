// Quick test to debug projection returns
const testCase = {
  startingBalance: 52822,
  salary: 227000,
  spending: 70000,
  yearsToRetirement: 14, // Age 39 to 53
  savingsRate: (227000 - 70000) / 227000, // About 69% savings rate
};

console.log('Test case analysis:');
console.log('Starting balance:', testCase.startingBalance);
console.log('Annual salary:', testCase.salary);
console.log('Annual spending:', testCase.spending);
console.log('Annual savings potential:', testCase.salary - testCase.spending);
console.log('Years to retirement:', testCase.yearsToRetirement);
console.log('Savings rate:', Math.round(testCase.savingsRate * 100) + '%');

// Simple 7% real return projection
const annualSavings = testCase.salary - testCase.spending;
let balance = testCase.startingBalance;
console.log('\nSimple 7% return projection:');
console.log('Year 0 balance:', balance);

for (let year = 1; year <= testCase.yearsToRetirement; year++) {
  balance = balance * 1.07 + annualSavings; // 7% growth + savings
  if (year % 5 === 0 || year === testCase.yearsToRetirement) {
    console.log(`Year ${year} balance:`, Math.round(balance));
  }
}

console.log('\nWith 69% savings rate ($157K/year) and 7% returns:');
console.log('Expected balance at retirement:', Math.round(balance));
console.log('This should be around $3-4M, NOT $15M+');

// What return would give $15M?
const targetWealth = 15500000;
let testBalance = testCase.startingBalance;
let impliedReturn = 0;

// Solve for the return rate that gives target wealth
for (let returnRate = 0.01; returnRate <= 0.50; returnRate += 0.001) {
  testBalance = testCase.startingBalance;
  for (let year = 1; year <= testCase.yearsToRetirement; year++) {
    testBalance = testBalance * (1 + returnRate) + annualSavings;
  }
  if (testBalance >= targetWealth) {
    impliedReturn = returnRate;
    break;
  }
}

console.log('\nTo achieve $15.5M terminal wealth would require:');
console.log('Implied annual return:', Math.round(impliedReturn * 100) + '%');
console.log('This is impossible for stock returns!');