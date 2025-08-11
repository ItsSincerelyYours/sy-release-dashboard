// Vercel Serverless Function: /api/tasks
// Fetches upcoming tasks from release projects

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const ASANA_TOKEN = process.env.ASANA_TOKEN;
    const WORKSPACE_ID = process.env.ASANA_WORKSPACE_ID;

    if (!ASANA_TOKEN || !WORKSPACE_ID) {
      throw new Error('Missing environment variables');
    }

    // First, get release projects
    const projectsResponse = await fetch(
      `https://app.asana.com/api/1.0/projects?workspace=${WORKSPACE_ID}&opt_fields=name,due_date`,
      {
        headers: {
          'Authorization': `Bearer ${ASANA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!projectsResponse.ok) {
      throw new Error(`Asana API error: ${projectsResponse.status}`);
    }

    const projectsData = await projectsResponse.json();

    // Filter for release projects
    const releaseKeywords = [
      'release', 'ep', 'single', 'album', 
      '[ep', '[single', '[album', '[release'
    ];

    const releaseProjects = projectsData.data.filter(project => {
      const name = project.name.toLowerCase();
      return releaseKeywords.some(keyword => name.includes(keyword.toLowerCase()));
    });

    console.log(`Processing tasks for ${releaseProjects.length} release projects`);

    // Get tasks from all release projects
    const allTasks = [];
    const today = new Date();
    const thirtyDaysFromNow = new Date(today.getTime() + (30 * 24 * 60 * 60 * 1000));

    // Process projects in batches to respect rate limits
    const batchSize = 5;
    for (let i = 0; i < releaseProjects.length; i += batchSize) {
      const batch = releaseProjects.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (project) => {
        try {
          const tasksResponse = await fetch(
            `https://app.asana.com/api/1.0/projects/${project.gid}/tasks?opt_fields=name,due_on,assignee.name,completed,created_at,notes`,
            {
              headers: {
                'Authorization': `Bearer ${ASANA_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );

          if (!tasksResponse.ok) {
            console.warn(`Failed to fetch tasks for project ${project.name}: ${tasksResponse.status}`);
            return [];
          }

          const tasksData = await tasksResponse.json();
          
          // Filter for upcoming tasks (due within 30 days and not completed)
          const upcomingTasks = tasksData.data.filter(task => {
            // Skip completed tasks
            if (task.completed) return false;
            
            // Skip tasks without due dates
            if (!task.due_on) return false;
            
            // Check if due within next 30 days
            const dueDate = new Date(task.due_on);
            return dueDate >= today && dueDate <= thirtyDaysFromNow;
          });

          // Add project information to each task
          return upcomingTasks.map(task => ({
            ...task,
            project_name: project.name,
            project_gid: project.gid,
            project_due_date: project.due_date
          }));

        } catch (error) {
          console.warn(`Error fetching tasks for project ${project.name}:`, error.message);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(tasks => allTasks.push(...tasks));

      // Add small delay between batches to be respectful to API
      if (i + batchSize < releaseProjects.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Sort tasks by due date
    allTasks.sort((a, b) => new Date(a.due_on) - new Date(b.due_on));

    console.log(`Found ${allTasks.length} upcoming tasks across ${releaseProjects.length} projects`);

    res.status(200).json({
      success: true,
      tasks: allTasks,
      count: allTasks.length,
      projects_processed: releaseProjects.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
