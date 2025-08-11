// Vercel Serverless Function: /api/releases
// Fetches release projects from Asana workspace

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

  // Only allow GET requests
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

    // Fetch all projects from workspace
    const projectsResponse = await fetch(
      `https://app.asana.com/api/1.0/projects?workspace=${WORKSPACE_ID}&opt_fields=name,due_date,created_at,owner.name,notes,archived`,
      {
        headers: {
          'Authorization': `Bearer ${ASANA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!projectsResponse.ok) {
      throw new Error(`Asana API error: ${projectsResponse.status} ${projectsResponse.statusText}`);
    }

    const projectsData = await projectsResponse.json();

    // Filter for release projects
    const releaseKeywords = [
      'release', 'ep', 'single', 'album', 
      '[ep', '[single', '[album', '[release',
      'EP Release', 'Single Release', 'Album Release'
    ];

    const releaseProjects = projectsData.data.filter(project => {
      // Skip archived projects
      if (project.archived) return false;
      
      const name = project.name.toLowerCase();
      return releaseKeywords.some(keyword => name.includes(keyword.toLowerCase()));
    });

    // Sort by due date (earliest first)
    releaseProjects.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date) - new Date(b.due_date);
    });

    console.log(`Found ${releaseProjects.length} release projects out of ${projectsData.data.length} total projects`);

    res.status(200).json({
      success: true,
      projects: releaseProjects,
      count: releaseProjects.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching releases:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
