// Football Trivia — async, self-paced, one question at a time. Each player is
// dealt a random 10 questions from a shared pool and races a 10-second clock
// on each one: answering correctly with 5+ seconds left earns 5 points, 4+
// left earns 4, and so on down to 1+ left earning 1 — running out (or
// answering wrong) earns 0. Ranked by total points, ties broken by total
// time taken (faster wins).
const id = 'trivia';
const name = 'Football Trivia';
const description = 'Real NFL trivia from the last 20 years, one question at a time on a 10-second clock — answer fast for more points. 10 random questions per player from a shared pool.';
const category = 'trivia';
const supportedModes = ['async'];

const QUESTIONS_PER_PLAYER = 10;
const COUNTDOWN_SECONDS = 10;

// A shared pool — each player gets a random 10 of these, so different people
// in the same league usually see a different quiz. Spans roughly 2005-2025.
const QUESTIONS = [
  // --- Super Bowl winners ---
  { id: 'sbw1', text: 'Who won Super Bowl XXXIX (played after the 2004 season)?', choices: ['Philadelphia Eagles', 'New England Patriots', 'Pittsburgh Steelers', 'Indianapolis Colts'], correctIndex: 1 },
  { id: 'sbw2', text: 'Who won Super Bowl XL (played after the 2005 season)?', choices: ['Seattle Seahawks', 'Denver Broncos', 'Pittsburgh Steelers', 'Carolina Panthers'], correctIndex: 2 },
  { id: 'sbw3', text: 'Who won Super Bowl XLI (played after the 2006 season)?', choices: ['Chicago Bears', 'Indianapolis Colts', 'New Orleans Saints', 'New England Patriots'], correctIndex: 1 },
  { id: 'sbw4', text: 'Who won Super Bowl XLII (played after the 2007 season), spoiling the Patriots\' undefeated season?', choices: ['New York Giants', 'Green Bay Packers', 'Dallas Cowboys', 'Tampa Bay Buccaneers'], correctIndex: 0 },
  { id: 'sbw5', text: 'Who won Super Bowl XLIII (played after the 2008 season)?', choices: ['Arizona Cardinals', 'Pittsburgh Steelers', 'Baltimore Ravens', 'Tennessee Titans'], correctIndex: 1 },
  { id: 'sbw6', text: 'Who won Super Bowl XLIV (played after the 2009 season)?', choices: ['Indianapolis Colts', 'Minnesota Vikings', 'New Orleans Saints', 'New York Jets'], correctIndex: 2 },
  { id: 'sbw7', text: 'Who won Super Bowl XLV (played after the 2010 season)?', choices: ['Pittsburgh Steelers', 'Green Bay Packers', 'Chicago Bears', 'Baltimore Ravens'], correctIndex: 1 },
  { id: 'sbw8', text: 'Who won Super Bowl XLVI (played after the 2011 season), beating the Patriots for the second time in five years?', choices: ['New York Giants', 'San Francisco 49ers', 'Baltimore Ravens', 'Denver Broncos'], correctIndex: 0 },
  { id: 'sbw9', text: 'Who won Super Bowl XLVII (played after the 2012 season), the "Harbaugh Bowl" against the 49ers?', choices: ['Seattle Seahawks', 'Baltimore Ravens', 'Atlanta Falcons', 'New England Patriots'], correctIndex: 1 },
  { id: 'sbw10', text: 'Who won Super Bowl XLVIII (played after the 2013 season), routing the Broncos 43-8?', choices: ['Denver Broncos', 'San Francisco 49ers', 'Seattle Seahawks', 'New Orleans Saints'], correctIndex: 2 },
  { id: 'sbw11', text: 'Who won Super Bowl XLIX (played after the 2014 season), sealed by a goal-line interception?', choices: ['Seattle Seahawks', 'New England Patriots', 'Green Bay Packers', 'Arizona Cardinals'], correctIndex: 1 },
  { id: 'sbw12', text: 'Who won Super Bowl 50 (played after the 2015 season)?', choices: ['Carolina Panthers', 'Denver Broncos', 'Arizona Cardinals', 'New England Patriots'], correctIndex: 1 },
  { id: 'sbw13', text: 'Who won Super Bowl LI (played after the 2016 season) after trailing 28-3?', choices: ['Atlanta Falcons', 'Green Bay Packers', 'New England Patriots', 'Pittsburgh Steelers'], correctIndex: 2 },
  { id: 'sbw14', text: 'Who won Super Bowl LII (played after the 2017 season), upsetting the Patriots?', choices: ['Philadelphia Eagles', 'Minnesota Vikings', 'Jacksonville Jaguars', 'New Orleans Saints'], correctIndex: 0 },
  { id: 'sbw15', text: 'Who won Super Bowl LIII (played after the 2018 season)?', choices: ['Los Angeles Rams', 'Kansas City Chiefs', 'New England Patriots', 'New Orleans Saints'], correctIndex: 2 },
  { id: 'sbw16', text: 'Who won Super Bowl LIV (played after the 2019 season), ending a 50-year title drought?', choices: ['San Francisco 49ers', 'Kansas City Chiefs', 'Tennessee Titans', 'Green Bay Packers'], correctIndex: 1 },
  { id: 'sbw17', text: 'Who won Super Bowl LV (played after the 2020 season)?', choices: ['Kansas City Chiefs', 'Buffalo Bills', 'Tampa Bay Buccaneers', 'Green Bay Packers'], correctIndex: 2 },
  { id: 'sbw18', text: 'Who won Super Bowl LVI (played after the 2021 season), played in their home stadium?', choices: ['Cincinnati Bengals', 'Los Angeles Rams', 'San Francisco 49ers', 'Tennessee Titans'], correctIndex: 1 },
  { id: 'sbw19', text: 'Who won Super Bowl LVII (played after the 2022 season)?', choices: ['Philadelphia Eagles', 'Kansas City Chiefs', 'Cincinnati Bengals', 'San Francisco 49ers'], correctIndex: 1 },
  { id: 'sbw20', text: 'Who won Super Bowl LVIII (played after the 2023 season) in overtime?', choices: ['San Francisco 49ers', 'Baltimore Ravens', 'Kansas City Chiefs', 'Detroit Lions'], correctIndex: 2 },
  { id: 'sbw21', text: 'Who won Super Bowl LIX (played after the 2024 season)?', choices: ['Kansas City Chiefs', 'Philadelphia Eagles', 'Buffalo Bills', 'Washington Commanders'], correctIndex: 1 },

  // --- Super Bowl MVPs ---
  { id: 'sbm1', text: 'Who was named Super Bowl XLII MVP (played after the 2007 season) after the Giants beat the undefeated Patriots?', choices: ['Plaxico Burress', 'David Tyree', 'Eli Manning', 'Michael Strahan'], correctIndex: 2 },
  { id: 'sbm2', text: 'Who was named Super Bowl XLIV MVP (played after the 2009 season)?', choices: ['Reggie Bush', 'Drew Brees', 'Peyton Manning', 'Tracy Porter'], correctIndex: 1 },
  { id: 'sbm3', text: 'Who was named Super Bowl XLV MVP (played after the 2010 season)?', choices: ['Aaron Rodgers', 'Ben Roethlisberger', 'Greg Jennings', 'Clay Matthews'], correctIndex: 0 },
  { id: 'sbm4', text: 'Who was named Super Bowl XLVIII MVP (played after the 2013 season) despite not being a quarterback?', choices: ['Russell Wilson', 'Marshawn Lynch', 'Malcolm Smith', 'Richard Sherman'], correctIndex: 2 },
  { id: 'sbm5', text: 'Who was named Super Bowl XLIX MVP (played after the 2014 season) after New England\'s comeback win?', choices: ['Julian Edelman', 'Tom Brady', 'Rob Gronkowski', 'Malcolm Butler'], correctIndex: 1 },
  { id: 'sbm6', text: 'Who was named Super Bowl 50 MVP (played after the 2015 season) as a member of the Broncos\' defense?', choices: ['Von Miller', 'DeMarcus Ware', 'Chris Harris Jr.', 'T.J. Ward'], correctIndex: 0 },
  { id: 'sbm7', text: 'Who was named Super Bowl LI MVP (played after the 2016 season) after the 28-3 comeback?', choices: ['Julian Edelman', 'James White', 'Tom Brady', 'Danny Amendola'], correctIndex: 2 },
  { id: 'sbm8', text: 'Who was named Super Bowl LII MVP (played after the 2017 season), a backup quarterback at the time?', choices: ['Carson Wentz', 'Nick Foles', 'Zach Ertz', 'Alshon Jeffery'], correctIndex: 1 },
  { id: 'sbm9', text: 'Who was named Super Bowl LIII MVP (played after the 2018 season)?', choices: ['Tom Brady', 'Sony Michel', 'Julian Edelman', 'Stephon Gilmore'], correctIndex: 2 },
  { id: 'sbm10', text: 'Who was named Super Bowl LIV MVP (played after the 2019 season)?', choices: ['Patrick Mahomes', 'Travis Kelce', 'Damien Williams', 'Tyreek Hill'], correctIndex: 0 },
  { id: 'sbm11', text: 'Who was named Super Bowl LV MVP (played after the 2020 season) as the Buccaneers routed the Chiefs?', choices: ['Rob Gronkowski', 'Tom Brady', 'Leonard Fournette', 'Antonio Brown'], correctIndex: 1 },
  { id: 'sbm12', text: 'Who was named Super Bowl LVI MVP (played after the 2021 season) with two touchdown catches, including the game-winner?', choices: ['Matthew Stafford', 'Cooper Kupp', 'Aaron Donald', 'Odell Beckham Jr.'], correctIndex: 1 },
  { id: 'sbm13', text: 'Who was named Super Bowl LVII MVP (played after the 2022 season)?', choices: ['Jalen Hurts', 'Travis Kelce', 'Patrick Mahomes', 'A.J. Brown'], correctIndex: 2 },
  { id: 'sbm14', text: 'Who won Super Bowl LVIII MVP (played after the 2023 season), his third Super Bowl MVP award?', choices: ['Patrick Mahomes', 'Travis Kelce', 'Brock Purdy', 'Christian McCaffrey'], correctIndex: 0 },
  { id: 'sbm15', text: 'Who was named Super Bowl LIX MVP (played after the 2024 season)?', choices: ['Saquon Barkley', 'Jalen Hurts', 'A.J. Brown', 'Patrick Mahomes'], correctIndex: 1 },

  // --- Season MVP award winners ---
  { id: 'mvp1', text: 'Who won NFL MVP for the 2005 season, rushing for 27 touchdowns?', choices: ['Shaun Alexander', 'LaDainian Tomlinson', 'Larry Johnson', 'Tiki Barber'], correctIndex: 0 },
  { id: 'mvp2', text: 'Who won NFL MVP for the 2006 season, setting the single-season touchdowns record at the time?', choices: ['Peyton Manning', 'LaDainian Tomlinson', 'Drew Brees', 'Steven Jackson'], correctIndex: 1 },
  { id: 'mvp3', text: 'Who won NFL MVP for the 2007 season, going undefeated in the regular season?', choices: ['Tom Brady', 'Peyton Manning', 'Randy Moss', 'Eli Manning'], correctIndex: 0 },
  { id: 'mvp4', text: 'Who won NFL MVP for both the 2008 and 2009 seasons?', choices: ['Drew Brees', 'Peyton Manning', 'Kurt Warner', 'Philip Rivers'], correctIndex: 1 },
  { id: 'mvp5', text: 'Who won NFL MVP for the 2010 season?', choices: ['Tom Brady', 'Michael Vick', 'Aaron Rodgers', 'Peyton Manning'], correctIndex: 0 },
  { id: 'mvp6', text: 'Who won NFL MVP for the 2011 season?', choices: ['Drew Brees', 'Cam Newton', 'Aaron Rodgers', 'Matthew Stafford'], correctIndex: 2 },
  { id: 'mvp7', text: 'Who won NFL MVP for the 2012 season as a running back coming off ACL surgery?', choices: ['Adrian Peterson', 'Marshawn Lynch', 'Arian Foster', 'Doug Martin'], correctIndex: 0 },
  { id: 'mvp8', text: 'Who won NFL MVP for the 2013 season after a record-setting passing year?', choices: ['Cam Newton', 'Peyton Manning', 'Nick Foles', 'Tom Brady'], correctIndex: 1 },
  { id: 'mvp9', text: 'Who won NFL MVP for the 2014 season?', choices: ['Andrew Luck', 'DeMarco Murray', 'Aaron Rodgers', 'J.J. Watt'], correctIndex: 2 },
  { id: 'mvp10', text: 'Who won NFL MVP for the 2015 season, leading Carolina to a 15-1 record?', choices: ['Cam Newton', 'Carson Palmer', 'Tom Brady', 'Russell Wilson'], correctIndex: 0 },
  { id: 'mvp11', text: 'Who won NFL MVP for the 2016 season despite Atlanta missing the Super Bowl repeat?', choices: ['Matt Ryan', 'Drew Brees', 'Dak Prescott', 'Ezekiel Elliott'], correctIndex: 0 },
  { id: 'mvp12', text: 'Who won NFL MVP for the 2017 season?', choices: ['Carson Wentz', 'Tom Brady', 'Case Keenum', 'Todd Gurley'], correctIndex: 1 },
  { id: 'mvp13', text: 'Who won NFL MVP for the 2018 season in his first year as a full-time starter?', choices: ['Patrick Mahomes', 'Drew Brees', 'Jared Goff', 'Andrew Luck'], correctIndex: 0 },
  { id: 'mvp14', text: 'Who won NFL MVP for the 2019 season unanimously?', choices: ['Russell Wilson', 'Lamar Jackson', 'Patrick Mahomes', 'Christian McCaffrey'], correctIndex: 1 },
  { id: 'mvp15', text: 'Who won NFL MVP for the 2020 season?', choices: ['Josh Allen', 'Aaron Rodgers', 'Deshaun Watson', 'Patrick Mahomes'], correctIndex: 1 },
  { id: 'mvp16', text: 'Who won NFL MVP for the 2021 season, his second in a row?', choices: ['Tom Brady', 'Aaron Rodgers', 'Jonathan Taylor', 'Cooper Kupp'], correctIndex: 1 },
  { id: 'mvp17', text: 'Who won NFL MVP for the 2022 season?', choices: ['Joe Burrow', 'Josh Allen', 'Patrick Mahomes', 'Jalen Hurts'], correctIndex: 2 },
  { id: 'mvp18', text: 'Who won NFL MVP for the 2023 season, his second career MVP?', choices: ['Lamar Jackson', 'Dak Prescott', 'Brock Purdy', 'Tua Tagovailoa'], correctIndex: 0 },
  { id: 'mvp19', text: 'Who won Offensive Rookie of the Year for the 2012 season with a historic dual-threat debut?', choices: ['Andrew Luck', 'Robert Griffin III', 'Russell Wilson', 'Doug Martin'], correctIndex: 1 },
  { id: 'mvp20', text: 'Who won NFL Defensive Player of the Year multiple times in the 2010s and 2020s as a Rams defensive tackle?', choices: ['Von Miller', 'J.J. Watt', 'Aaron Donald', 'Khalil Mack'], correctIndex: 2 },
  { id: 'mvp21', text: 'Who won NFL MVP for the 2024 season, his first career MVP award?', choices: ['Josh Allen', 'Lamar Jackson', 'Joe Burrow', 'Jayden Daniels'], correctIndex: 0 },

  // --- #1 overall NFL Draft picks ---
  { id: 'dr1', text: 'Who was the #1 overall pick in the 2005 NFL Draft?', choices: ['Aaron Rodgers', 'Alex Smith', 'Braylon Edwards', 'Cadillac Williams'], correctIndex: 1 },
  { id: 'dr2', text: 'Who was the #1 overall pick in the 2007 NFL Draft?', choices: ['Calvin Johnson', 'JaMarcus Russell', 'LaRon Landry', 'Joe Thomas'], correctIndex: 1 },
  { id: 'dr3', text: 'Who was the #1 overall pick in the 2009 NFL Draft?', choices: ['Mark Sanchez', 'Matthew Stafford', 'Aaron Curry', 'Tim Tebow'], correctIndex: 1 },
  { id: 'dr4', text: 'Who was the #1 overall pick in the 2011 NFL Draft?', choices: ['Cam Newton', 'Von Miller', 'Marcell Dareus', 'A.J. Green'], correctIndex: 0 },
  { id: 'dr5', text: 'Who was the #1 overall pick in the 2012 NFL Draft?', choices: ['Robert Griffin III', 'Andrew Luck', 'Trent Richardson', 'Ryan Tannehill'], correctIndex: 1 },
  { id: 'dr6', text: 'Who was the #1 overall pick in the 2015 NFL Draft?', choices: ['Marcus Mariota', 'Jameis Winston', 'Leonard Williams', 'Amari Cooper'], correctIndex: 1 },
  { id: 'dr7', text: 'Who was the #1 overall pick in the 2016 NFL Draft?', choices: ['Carson Wentz', 'Jared Goff', 'Ezekiel Elliott', 'Joey Bosa'], correctIndex: 1 },
  { id: 'dr8', text: 'Which team drafted Patrick Mahomes 10th overall in 2017?', choices: ['Kansas City Chiefs', 'Buffalo Bills', 'Cleveland Browns', 'Houston Texans'], correctIndex: 0 },
  { id: 'dr9', text: 'Who was the #1 overall pick in the 2018 NFL Draft?', choices: ['Sam Darnold', 'Baker Mayfield', 'Josh Allen', 'Josh Rosen'], correctIndex: 1 },
  { id: 'dr10', text: 'Who was the #1 overall pick in the 2019 NFL Draft?', choices: ['Kyler Murray', 'Daniel Jones', 'Dwayne Haskins', 'Nick Bosa'], correctIndex: 0 },
  { id: 'dr11', text: 'Which team took quarterback Joe Burrow with the #1 pick in the 2020 draft?', choices: ['Miami Dolphins', 'Cincinnati Bengals', 'Los Angeles Chargers', 'Carolina Panthers'], correctIndex: 1 },
  { id: 'dr12', text: 'Who was the #1 overall pick in the 2021 NFL Draft, out of Clemson?', choices: ['Zach Wilson', 'Trey Lance', 'Trevor Lawrence', 'Justin Fields'], correctIndex: 2 },
  { id: 'dr13', text: 'Who was the #1 overall pick in the 2022 NFL Draft, the first defensive player taken first in years?', choices: ['Aidan Hutchinson', 'Travon Walker', 'Kayvon Thibodeaux', 'Kenny Pickett'], correctIndex: 1 },
  { id: 'dr14', text: 'Who was the #1 overall pick in the 2023 NFL Draft?', choices: ['C.J. Stroud', 'Bryce Young', 'Anthony Richardson', 'Will Levis'], correctIndex: 1 },
  { id: 'dr15', text: 'Who was the #1 overall pick in the 2024 NFL Draft?', choices: ['Jayden Daniels', 'Drake Maye', 'Caleb Williams', 'Marvin Harrison Jr.'], correctIndex: 2 },
  { id: 'dr16', text: 'Which college did Trevor Lawrence, the #1 pick in 2021, play for?', choices: ['Alabama', 'Clemson', 'Ohio State', 'Georgia'], correctIndex: 1 },
  { id: 'dr17', text: 'Which college did Joe Burrow, the #1 pick in 2020, play his Heisman-winning season for?', choices: ['Ohio State', 'LSU', 'Oklahoma', 'Alabama'], correctIndex: 1 },
  { id: 'dr18', text: 'Which team drafted Aaron Rodgers in 2005, where he later won a Super Bowl?', choices: ['San Francisco 49ers', 'Green Bay Packers', 'Minnesota Vikings', 'Detroit Lions'], correctIndex: 1 },
  { id: 'dr19', text: 'Which team drafted Justin Jefferson in the first round of the 2020 draft?', choices: ['Minnesota Vikings', 'Dallas Cowboys', 'Green Bay Packers', 'Detroit Lions'], correctIndex: 0 },
  { id: 'dr20', text: 'Which team selected Ja\'Marr Chase with the 5th overall pick in 2021?', choices: ['Cincinnati Bengals', 'Atlanta Falcons', 'Detroit Lions', 'New York Jets'], correctIndex: 0 },
  { id: 'dr21', text: 'Who was the #1 overall pick in the 2006 NFL Draft?', choices: ['Vince Young', 'Reggie Bush', 'Mario Williams', 'Matt Leinart'], correctIndex: 2 },
  { id: 'dr22', text: 'Who was the #1 overall pick in the 2008 NFL Draft, an offensive tackle?', choices: ['Matt Ryan', 'Jake Long', 'Chris Long', 'Darren McFadden'], correctIndex: 1 },
  { id: 'dr23', text: 'Who was the #1 overall pick in the 2010 NFL Draft?', choices: ['Tim Tebow', 'Sam Bradford', 'Ndamukong Suh', 'Gerald McCoy'], correctIndex: 1 },
  { id: 'dr24', text: 'Who was the #1 overall pick in the 2013 NFL Draft, an offensive tackle taken by the Chiefs?', choices: ['Eric Fisher', 'Luke Joeckel', 'Lane Johnson', 'Chance Warmack'], correctIndex: 0 },
  { id: 'dr25', text: 'Who was the #1 overall pick in the 2014 NFL Draft?', choices: ['Blake Bortles', 'Khalil Mack', 'Jadeveon Clowney', 'Sammy Watkins'], correctIndex: 2 },
  { id: 'dr26', text: 'Who was the #1 overall pick in the 2017 NFL Draft, a defensive end?', choices: ['Jamal Adams', 'Myles Garrett', 'Solomon Thomas', 'Marshon Lattimore'], correctIndex: 1 },
  { id: 'dr27', text: 'Who was the #1 overall pick in the 2025 NFL Draft?', choices: ['Travis Hunter', 'Cam Ward', 'Abdul Carter', 'Shedeur Sanders'], correctIndex: 1 },
  { id: 'dr28', text: 'Which team drafted quarterback Justin Herbert in the first round of the 2020 NFL Draft?', choices: ['Miami Dolphins', 'Los Angeles Chargers', 'Indianapolis Colts', 'Denver Broncos'], correctIndex: 1 },
  { id: 'dr29', text: 'Which team selected linebacker Micah Parsons with the 12th pick in the 2021 NFL Draft?', choices: ['Philadelphia Eagles', 'Dallas Cowboys', 'New York Giants', 'Washington Football Team'], correctIndex: 1 },
  { id: 'dr30', text: 'Which team drafted running back Saquon Barkley 2nd overall in 2018?', choices: ['New York Giants', 'Cleveland Browns', 'New York Jets', 'Denver Broncos'], correctIndex: 0 },

  // --- Rule changes, moves, and notable events ---
  { id: 'ev1', text: 'Which team relocated from St. Louis back to Los Angeles in 2016?', choices: ['Chargers', 'Raiders', 'Rams', 'Cardinals'], correctIndex: 2 },
  { id: 'ev2', text: 'Which team relocated from San Diego to Los Angeles in 2017?', choices: ['Chargers', 'Raiders', 'Rams', 'Broncos'], correctIndex: 0 },
  { id: 'ev3', text: 'Which team relocated from Oakland to Las Vegas in 2020?', choices: ['Chargers', 'Raiders', 'Rams', 'Titans'], correctIndex: 1 },
  { id: 'ev4', text: 'In what year did the NFL expand its regular season from 16 to 17 games?', choices: ['2019', '2020', '2021', '2023'], correctIndex: 2 },
  { id: 'ev5', text: 'What was Washington\'s NFL franchise renamed to in 2020, before later becoming the "Commanders"?', choices: ['Washington Federals', 'Washington Football Team', 'Washington Warriors', 'Washington Red Wolves'], correctIndex: 1 },
  { id: 'ev6', text: 'In what year did Washington\'s NFL team officially adopt the name "Commanders"?', choices: ['2020', '2021', '2022', '2023'], correctIndex: 2 },
  { id: 'ev7', text: 'Tom Brady left the Patriots in 2020 to sign with which team, whom he led to a Super Bowl win that same season?', choices: ['Tampa Bay Buccaneers', 'Las Vegas Raiders', 'San Francisco 49ers', 'Miami Dolphins'], correctIndex: 0 },
  { id: 'ev8', text: 'Russell Wilson was traded from the Seahawks to which team in 2022?', choices: ['Denver Broncos', 'New Orleans Saints', 'Pittsburgh Steelers', 'Atlanta Falcons'], correctIndex: 0 },
  { id: 'ev9', text: 'Matthew Stafford was traded from the Lions to which team in 2021, winning a Super Bowl that season?', choices: ['Los Angeles Rams', 'Indianapolis Colts', 'Denver Broncos', 'Carolina Panthers'], correctIndex: 0 },
  { id: 'ev10', text: 'Aaron Rodgers left the Packers to sign with which team in 2023?', choices: ['New York Giants', 'New York Jets', 'Pittsburgh Steelers', 'Las Vegas Raiders'], correctIndex: 1 },
  { id: 'ev11', text: 'The 2022 playoff overtime rule change guarantees both teams a possession even if the first team scores what on its opening drive?', choices: ['A field goal', 'A touchdown', 'A safety', 'Any score'], correctIndex: 1 },
  { id: 'ev12', text: 'In what year was regular-season overtime shortened from 15 minutes to 10?', choices: ['2012', '2015', '2017', '2019'], correctIndex: 2 },
  { id: 'ev13', text: 'The "Philly Special" trick-play touchdown happened in which Super Bowl?', choices: ['Super Bowl XLIX', 'Super Bowl LI', 'Super Bowl LII', 'Super Bowl LIII'], correctIndex: 2 },
  { id: 'ev14', text: 'Which team went winless at 0-16 during the 2008 regular season, an NFL first?', choices: ['Detroit Lions', 'Oakland Raiders', 'St. Louis Rams', 'Kansas City Chiefs'], correctIndex: 0 },
  { id: 'ev15', text: 'Which team had a perfect 16-0 regular season in 2007 but lost the Super Bowl?', choices: ['Indianapolis Colts', 'New England Patriots', 'Green Bay Packers', 'Pittsburgh Steelers'], correctIndex: 1 },
  { id: 'ev16', text: 'A defensive penalty called on quarterback hits was given greater emphasis starting in 2018 — which one?', choices: ['Roughing the passer', 'Facemask', 'Horse-collar tackle', 'Targeting'], correctIndex: 0 },
  { id: 'ev17', text: 'After a controversial no-call in the 2018 NFC Championship, the NFL briefly made which penalty reviewable in 2019?', choices: ['Holding', 'Pass interference', 'Roughing the passer', 'Illegal contact'], correctIndex: 1 },
  { id: 'ev18', text: 'Which stadium in Las Vegas hosted Super Bowl LVIII in 2024?', choices: ['T-Mobile Arena', 'Allegiant Stadium', 'Sphere', 'Sam Boyd Stadium'], correctIndex: 1 },
  { id: 'ev19', text: 'What annual pre-draft event is famous for prospects running the 40-yard dash and other drills?', choices: ['The Pro Bowl', 'The NFL Scouting Combine', 'The Senior Bowl', 'Rookie Minicamp'], correctIndex: 1 },
  { id: 'ev20', text: 'In 2024, the NFL introduced a new kickoff format widely referred to as what?', choices: ['The safe kick', 'The dynamic kickoff', 'The fair-catch kickoff', 'The touchback rule'], correctIndex: 1 },
  { id: 'ev21', text: 'Roger Goodell has served as NFL Commissioner since what year?', choices: ['2002', '2006', '2010', '2014'], correctIndex: 1 },
  { id: 'ev22', text: 'A 2021 NFL rule change allowed which position group to wear single-digit jersey numbers for the first time in decades?', choices: ['Running backs', 'Wide receivers', 'Tight ends', 'Linebackers'], correctIndex: 1 },
  { id: 'ev23', text: 'Which team went winless at 0-16 during the 2017 regular season?', choices: ['Cleveland Browns', 'San Francisco 49ers', 'New York Giants', 'Indianapolis Colts'], correctIndex: 0 },
  { id: 'ev24', text: 'Michael Vick made his NFL comeback in 2009 with which team after his release from prison?', choices: ['Atlanta Falcons', 'Philadelphia Eagles', 'Pittsburgh Steelers', 'New York Jets'], correctIndex: 1 },
  { id: 'ev25', text: 'Which team hired Sean Payton as head coach in 2023 after he spent a year away from coaching?', choices: ['Denver Broncos', 'Carolina Panthers', 'Chicago Bears', 'Las Vegas Raiders'], correctIndex: 0 },
  { id: 'ev26', text: 'Which quarterback stunned the NFL by abruptly retiring from the Colts just before the 2019 season?', choices: ['Andrew Luck', 'Philip Rivers', 'Jacoby Brissett', 'Carson Wentz'], correctIndex: 0 },

  // --- Records and milestones ---
  { id: 'rec1', text: 'Who set the single-season passing yards record (5,477) in 2013?', choices: ['Tom Brady', 'Drew Brees', 'Peyton Manning', 'Aaron Rodgers'], correctIndex: 2 },
  { id: 'rec2', text: 'Who set the single-season passing touchdowns record (55) in 2013?', choices: ['Peyton Manning', 'Tom Brady', 'Cam Newton', 'Matt Ryan'], correctIndex: 0 },
  { id: 'rec3', text: 'Who set the single-season receiving yards record (1,964) in 2012?', choices: ['Julio Jones', 'Calvin Johnson', 'Antonio Brown', 'DeAndre Hopkins'], correctIndex: 1 },
  { id: 'rec4', text: 'Who set the single-season receptions record (149) in 2019?', choices: ['Michael Thomas', 'DeAndre Hopkins', 'Davante Adams', 'Cooper Kupp'], correctIndex: 0 },
  { id: 'rec5', text: 'Which running back rushed for 2,027 yards in the 2020 season?', choices: ['Dalvin Cook', 'Derrick Henry', 'Alvin Kamara', 'Jonathan Taylor'], correctIndex: 1 },
  { id: 'rec6', text: 'Which receiver led the NFL in catches, receiving yards, and receiving touchdowns (the "triple crown") in 2021?', choices: ['Justin Jefferson', 'Davante Adams', 'Cooper Kupp', 'Stefon Diggs'], correctIndex: 2 },
  { id: 'rec7', text: 'Which quarterback became the NFL\'s all-time career passing yards leader, surpassing Drew Brees?', choices: ['Aaron Rodgers', 'Tom Brady', 'Matthew Stafford', 'Philip Rivers'], correctIndex: 1 },
  { id: 'rec8', text: 'How many Super Bowls did Tom Brady win as a starting quarterback (through Super Bowl LIX)?', choices: ['5', '6', '7', '8'], correctIndex: 2 },
  { id: 'rec9', text: 'Which head coach holds the record for most Super Bowl appearances by a coach, with 9?', choices: ['Andy Reid', 'Bill Belichick', 'Sean McVay', 'Pete Carroll'], correctIndex: 1 },
  { id: 'rec10', text: 'Which player made the famous "Helmet Catch" pinning the ball to his helmet in Super Bowl XLII?', choices: ['Plaxico Burress', 'David Tyree', 'Amani Toomer', 'Steve Smith'], correctIndex: 1 },
  { id: 'rec11', text: 'Which cornerback\'s goal-line interception sealed the Patriots\' win in Super Bowl XLIX?', choices: ['Darrelle Revis', 'Malcolm Butler', 'Devin McCourty', 'Brandon Browner'], correctIndex: 1 },
  { id: 'rec12', text: 'Which team overcame a 28-3 deficit to win Super Bowl LI in overtime?', choices: ['Atlanta Falcons', 'New England Patriots', 'Denver Broncos', 'Green Bay Packers'], correctIndex: 1 },
  { id: 'rec13', text: 'The Chiefs ended a 50-year championship drought by beating which team in Super Bowl LIV?', choices: ['San Francisco 49ers', 'Green Bay Packers', 'Tennessee Titans', 'Baltimore Ravens'], correctIndex: 0 },
  { id: 'rec14', text: 'Which defensive tackle won Defensive Player of the Year three times with the Rams before retiring in 2024?', choices: ['J.J. Watt', 'Khalil Mack', 'Aaron Donald', 'Myles Garrett'], correctIndex: 2 },
  { id: 'rec15', text: 'Which quarterback has thrown for the most career passing touchdowns in NFL history?', choices: ['Drew Brees', 'Tom Brady', 'Peyton Manning', 'Brett Favre'], correctIndex: 1 },
  { id: 'rec16', text: 'Which kicker made the longest field goal in NFL history, a 66-yarder in 2021?', choices: ['Justin Tucker', 'Matt Prater', 'Harrison Butker', 'Younghoe Koo'], correctIndex: 0 },
  { id: 'rec17', text: 'Who holds the NFL single-game rushing record with 296 yards in a 2007 game?', choices: ['Chris Johnson', 'Derrick Henry', 'Adrian Peterson', 'LaDainian Tomlinson'], correctIndex: 2 },
  { id: 'rec18', text: 'Who is the NFL\'s all-time leading rusher?', choices: ['Barry Sanders', 'Emmitt Smith', 'Walter Payton', 'Frank Gore'], correctIndex: 1 },
  { id: 'rec19', text: 'Who holds the NFL record for most career receiving yards?', choices: ['Randy Moss', 'Terrell Owens', 'Jerry Rice', 'Larry Fitzgerald'], correctIndex: 2 },
  { id: 'rec20', text: 'Who became the youngest head coach to win a Super Bowl, doing so with the Steelers after the 2008 season?', choices: ['Sean McVay', 'Mike Tomlin', 'John Harbaugh', 'Mike McCarthy'], correctIndex: 1 },
  { id: 'rec21', text: 'Who holds the NFL record for most career return touchdowns?', choices: ['Devin Hester', 'Cordarrelle Patterson', 'Josh Cribbs', 'Dante Hall'], correctIndex: 0 },
  { id: 'rec22', text: 'Which running back rushed for over 2,000 yards for the Eagles in the 2024 season, the second-most in a single season ever?', choices: ['Saquon Barkley', 'Derrick Henry', 'Christian McCaffrey', 'Josh Jacobs'], correctIndex: 0 },

  // --- General football knowledge (timeless rules) ---
  { id: 'gen1', text: 'What color flag does a coach or official throw to indicate a challenge or penalty?', choices: ['Yellow', 'Red', 'Orange', 'White'], correctIndex: 1 },
  { id: 'gen2', text: 'How many points is a touchdown worth, before any extra-point attempt?', choices: ['3', '6', '7', '8'], correctIndex: 1 },
  { id: 'gen3', text: 'How many points is a safety worth?', choices: ['1', '2', '3', '6'], correctIndex: 1 },
  { id: 'gen4', text: 'How many timeouts does each team get per half?', choices: ['2', '3', '4', '5'], correctIndex: 1 },
  { id: 'gen5', text: 'What is it called when a quarterback deliberately throws the ball away with no eligible receiver nearby to avoid a sack?', choices: ['Delay of game', 'Intentional grounding', 'Illegal forward pass', 'False start'], correctIndex: 1 },
  { id: 'gen6', text: 'Which conference do the Kansas City Chiefs play in?', choices: ['NFC', 'AFC', 'Both', 'Neither'], correctIndex: 1 },
  { id: 'gen7', text: 'Which conference do the Philadelphia Eagles play in?', choices: ['AFC', 'NFC', 'Both', 'Neither'], correctIndex: 1 },
  { id: 'gen8', text: 'What is the term for a defensive player lining up across the line of scrimmage before the snap?', choices: ['Offside', 'Encroachment', 'Delay of game', 'Illegal formation'], correctIndex: 0 },
  { id: 'gen9', text: 'How many on-field officials typically work an NFL game?', choices: ['5', '6', '7', '8'], correctIndex: 2 },
  { id: 'gen10', text: 'Which network has aired "Monday Night Football" since 2006?', choices: ['NBC', 'FOX', 'CBS', 'ESPN'], correctIndex: 3 },
  { id: 'gen11', text: 'What is a "Hail Mary" in football?', choices: ['A long, desperation pass thrown as time runs out', 'A trick punt formation', 'A defensive blitz package', 'An onside kick'], correctIndex: 0 },
  { id: 'gen12', text: 'How many yards does an offense need to gain for a new set of downs?', choices: ['5', '10', '15', '20'], correctIndex: 1 },
  { id: 'gen13', text: 'What is it called when a quarterback is tackled behind the line of scrimmage while attempting to pass?', choices: ['A sack', 'A safety', 'A hold', 'A pick'], correctIndex: 0 },
  { id: 'gen14', text: 'How many players are on the field for one team during a play?', choices: ['9', '10', '11', '12'], correctIndex: 2 },
  { id: 'gen15', text: 'What is the standard NFL active roster size during the regular season?', choices: ['46', '48', '53', '60'], correctIndex: 2 },
  { id: 'gen16', text: 'How many quarters are in a regulation NFL game?', choices: ['2', '3', '4', '5'], correctIndex: 2 },
  { id: 'gen17', text: 'How many minutes long is one regulation NFL quarter?', choices: ['10', '12', '15', '20'], correctIndex: 2 },
  { id: 'gen18', text: 'What is it commonly called when a defender intercepts a pass and returns it for a touchdown?', choices: ['A pick-six', 'A scoop-and-score', 'A takeaway', 'A turnover-six'], correctIndex: 0 },
  { id: 'gen19', text: 'Which conference do the Dallas Cowboys play in?', choices: ['AFC', 'NFC', 'Both', 'Neither'], correctIndex: 1 },
  { id: 'gen20', text: 'Which conference do the Buffalo Bills play in?', choices: ['AFC', 'NFC', 'Both', 'Neither'], correctIndex: 0 },
  { id: 'gen21', text: 'On NFL gamedays, how many of a team\'s 53-man roster are typically active (eligible to play)?', choices: ['46 or 48', '50', '53', '40'], correctIndex: 0 },
  { id: 'gen22', text: 'Which news organization\'s writers vote on the NFL MVP and other year-end awards?', choices: ['ESPN', 'The Associated Press', 'Pro Football Focus', 'Sports Illustrated'], correctIndex: 1 },
];

function publicQuestions() {
  return QUESTIONS.map((q) => ({ id: q.id, text: q.text, choices: q.choices }));
}

function findQuestion(qId) {
  return QUESTIONS.find((q) => q.id === qId);
}

function shuffledIds(count) {
  const pool = QUESTIONS.map((q) => q.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function initInstance() {
  return { config: {}, state: { players: {} }, status: 'ready' };
}

function getOrCreatePlayer(state, memberId) {
  if (!state.players[memberId]) {
    state.players[memberId] = {
      questionIds: shuffledIds(QUESTIONS_PER_PLAYER),
      currentIndex: 0,
      presentedAt: null,
      answers: [], // answers[i] corresponds to questionIds[i], once answered
      totalPoints: 0,
      completed: false,
    };
  }
  return state.players[memberId];
}

// Marks "now" as when the current question's countdown starts — called each
// time the player's view is fetched, but only while that question is still
// unanswered (so re-fetching after answering, right before "Next", doesn't
// reset anything).
function presentCurrentQuestion(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (!player.completed && player.answers[player.currentIndex] == null) {
    player.presentedAt = Date.now();
  }
  return player;
}

// The question the player should currently see (or null once they're done),
// with the answer key stripped and — if this question already has a recorded
// answer (they refreshed after answering) — that outcome included so the
// client can show it instead of re-asking.
function currentQuestionView(player) {
  if (player.completed || player.currentIndex >= player.questionIds.length) return null;
  const q = findQuestion(player.questionIds[player.currentIndex]);
  return {
    index: player.currentIndex,
    total: player.questionIds.length,
    text: q.text,
    choices: q.choices,
    answered: player.answers[player.currentIndex] || null,
  };
}

// Scores the player's CURRENT question — idempotent, so a duplicate/retried
// request doesn't re-score it. `choiceIndex` may be null for a timeout.
function submitAnswer(state, memberId, choiceIndex) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.answers[idx] != null) return player.answers[idx];

  const q = findQuestion(player.questionIds[idx]);
  const elapsedMs = Math.max(0, Date.now() - (player.presentedAt || Date.now()));
  const remainingSeconds = COUNTDOWN_SECONDS - elapsedMs / 1000;
  const correct = choiceIndex != null && choiceIndex === q.correctIndex;

  let points = 0;
  if (correct) {
    if (remainingSeconds >= 5) points = 5;
    else if (remainingSeconds >= 4) points = 4;
    else if (remainingSeconds >= 3) points = 3;
    else if (remainingSeconds >= 2) points = 2;
    else if (remainingSeconds >= 1) points = 1;
    else points = 0;
  }

  const result = { choiceIndex, correct, correctIndex: q.correctIndex, points, elapsedMs };
  player.answers[idx] = result;
  player.totalPoints += points;
  return result;
}

// Moves the player to their next question (or marks them complete if that
// was their last). Only valid once the current question has been answered.
function advanceToNext(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return player;
  if (player.answers[player.currentIndex] == null) return { error: 'not-answered-yet' };

  player.currentIndex += 1;
  player.presentedAt = null;
  if (player.currentIndex >= player.questionIds.length) {
    player.completed = true;
    player.completedAt = Date.now();
  }
  return player;
}

function isComplete(state, memberIds) {
  return memberIds.every((mid) => state.players[mid] && state.players[mid].completed);
}

function computeResults(state) {
  const entries = Object.entries(state.players).map(([memberId, p]) => {
    const totalTimeMs = p.answers.reduce((sum, a) => sum + (a ? a.elapsedMs : 0), 0);
    return { memberId, totalPoints: p.totalPoints, totalTimeMs };
  });
  entries.sort((x, y) => (y.totalPoints - x.totalPoints) || (x.totalTimeMs - y.totalTimeMs));
  return entries.map((e, i) => ({ memberId: e.memberId, rank: i + 1 }));
}

module.exports = {
  id, name, description, category, supportedModes,
  QUESTIONS, QUESTIONS_PER_PLAYER, COUNTDOWN_SECONDS,
  publicQuestions, initInstance, getOrCreatePlayer, presentCurrentQuestion,
  currentQuestionView, submitAnswer, advanceToNext, isComplete, computeResults,
};
